/**
 * Route tests for the decomposition surface.
 *
 * Against a fake service: what matters here is the HTTP shape and the board
 * fan-out — that creating a plan announces every new card plus the parent, and
 * that reading one changes nothing.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import type { SubtaskRow, TaskRow } from '@/modules/database/index.js';
import { createTaskDecompositionRouter } from '@/modules/tasks/task-decomposition.routes.js';
import type {
  TaskDecomposition,
  TaskDecompositionService,
} from '@/modules/tasks/services/task-decomposition.service.js';
import { TaskNotFoundError } from '@/modules/tasks/tasks.errors.js';
import type { TaskUpdateAction } from '@/modules/tasks/task-update-broadcast.js';
import { AppError } from '@/shared/utils.js';

const PARENT: SubtaskRow = {
  id: 'task-1',
  project_name: 'my-app',
  title: 'Ship the importer',
  description: null,
  stage: 'backlog',
  origin: 'user',
  origin_detail: null,
  assignee_profile_id: null,
  suggested_skill: null,
  worktree_branch: null,
  parent_task_id: null,
  created_at: '2026-08-10T00:00:00.000Z',
  updated_at: '2026-08-10T00:00:00.000Z',
};

const SUBTASKS: SubtaskRow[] = [
  { ...PARENT, id: 'task-2', title: 'Parse the CSV', parent_task_id: PARENT.id },
  { ...PARENT, id: 'task-3', title: 'Write the loader', parent_task_id: PARENT.id },
];

const DECOMPOSITION: TaskDecomposition = {
  parent: PARENT,
  subtasks: SUBTASKS,
  dependencies: [
    {
      task_id: 'task-3',
      depends_on_task_id: 'task-2',
      created_at: '2026-08-10T00:00:00.000Z',
    },
  ],
};

function createFakeService(overrides: Partial<TaskDecompositionService> = {}): TaskDecompositionService {
  return {
    decompose: () => {
      throw new Error('Unexpected decompose call');
    },
    getDecomposition: () => {
      throw new Error('Unexpected getDecomposition call');
    },
    listReady: () => {
      throw new Error('Unexpected listReady call');
    },
    listBlockers: () => {
      throw new Error('Unexpected listBlockers call');
    },
    ...overrides,
  };
}

async function withServer(
  service: TaskDecompositionService,
  broadcastCalls: Array<[TaskRow, TaskUpdateAction]>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/tasks',
    createTaskDecompositionRouter(service, (task, action) => {
      broadcastCalls.push([task, action]);
    }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.code });
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('POST /:id/subtasks stores the plan and broadcasts every new card plus the parent', async () => {
  const bodies: Array<[unknown, Record<string, unknown>]> = [];
  const service = createFakeService({
    decompose: (parentTaskId, body) => {
      bodies.push([parentTaskId, body]);
      return DECOMPOSITION;
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/task-1/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subtasks: [{ title: 'Parse the CSV' }] }),
    });
    const payload = (await response.json()) as { success: boolean; data: TaskDecomposition };

    assert.equal(response.status, 201);
    assert.equal(payload.success, true);
    assert.equal(payload.data.subtasks.length, 2);
    assert.equal(payload.data.dependencies.length, 1);
  });

  assert.equal(bodies[0]![0], 'task-1');
  assert.deepEqual(
    broadcastCalls.map(([task, action]) => [task.id, action]),
    [
      ['task-2', 'created'],
      ['task-3', 'created'],
      ['task-1', 'updated'],
    ],
  );
});

test('GET /:id/subtasks returns the plan without broadcasting', async () => {
  const service = createFakeService({ getDecomposition: () => DECOMPOSITION });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/task-1/subtasks`);
    const payload = (await response.json()) as { data: TaskDecomposition };

    assert.equal(response.status, 200);
    assert.equal(payload.data.parent.id, 'task-1');
  });

  assert.equal(broadcastCalls.length, 0);
});

test('GET /:id/subtasks/ready answers only the startable subtasks', async () => {
  const service = createFakeService({ listReady: () => [SUBTASKS[0]] });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/task-1/subtasks/ready`);
    const payload = (await response.json()) as { data: { ready: SubtaskRow[] } };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.ready.map((task) => task.id), ['task-2']);
  });

  assert.equal(broadcastCalls.length, 0);
});

test('a named service error keeps its status through the router', async () => {
  const service = createFakeService({
    decompose: () => {
      throw new TaskNotFoundError('task-missing');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/task-missing/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subtasks: [{ title: 'Anything' }] }),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'TASK_NOT_FOUND' });
  });

  assert.equal(broadcastCalls.length, 0);
});
