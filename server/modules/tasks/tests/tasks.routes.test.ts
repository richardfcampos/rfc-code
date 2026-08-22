import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import type { TaskRow } from '@/modules/database/index.js';
import type { TaskUpdateAction } from '@/modules/tasks/task-update-broadcast.js';
import { createTasksRouter } from '@/modules/tasks/tasks.routes.js';
import {
  TaskNotFoundError,
  TaskValidationError,
  type TasksService,
} from '@/modules/tasks/tasks.service.js';
import { AppError } from '@/shared/utils.js';

const TASK: TaskRow = {
  id: 'task-1',
  project_name: 'my-app',
  title: 'Ship it',
  description: null,
  stage: 'backlog',
  origin: 'user',
  origin_detail: null,
  assignee_profile_id: null,
  suggested_skill: null,
  worktree_branch: null,
  created_at: '2026-08-10T00:00:00.000Z',
  updated_at: '2026-08-10T00:00:00.000Z',
};

function createFakeService(overrides: Partial<TasksService> = {}): TasksService {
  return {
    createTask: async () => {
      throw new Error('Unexpected createTask call');
    },
    listTasks: () => {
      throw new Error('Unexpected listTasks call');
    },
    updateTask: async () => {
      throw new Error('Unexpected updateTask call');
    },
    deleteTask: () => {
      throw new Error('Unexpected deleteTask call');
    },
    ...overrides,
  };
}

async function withTasksServer(
  service: TasksService,
  broadcastCalls: Array<[TaskRow, TaskUpdateAction]>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/tasks',
    createTasksRouter(service, (task, action) => {
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

test('GET / lists tasks for the requested project', async () => {
  const service = createFakeService({
    listTasks: (project) => {
      assert.equal(project, 'my-app');
      return [TASK];
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks?project=my-app`);
    const payload = (await response.json()) as { success: boolean; data: { tasks: TaskRow[] } };

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.tasks.length, 1);
    assert.equal(payload.data.tasks[0]!.id, TASK.id);
  });

  assert.equal(broadcastCalls.length, 0);
});

test('GET / maps a missing project to 400', async () => {
  const service = createFakeService({
    listTasks: () => {
      throw new TaskValidationError('project is required');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks`);
    assert.equal(response.status, 400);
  });
});

test('POST / creates a task, returns 201 and broadcasts "created"', async () => {
  const service = createFakeService({
    createTask: async (body) => {
      assert.equal((body as Record<string, unknown>).title, 'Ship it');
      return TASK;
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Ship it', project: 'my-app' }),
    });
    const payload = (await response.json()) as { data: { task: TaskRow } };

    assert.equal(response.status, 201);
    assert.equal(payload.data.task.id, TASK.id);
  });

  assert.equal(broadcastCalls.length, 1);
  assert.equal(broadcastCalls[0]![0].id, TASK.id);
  assert.equal(broadcastCalls[0]![1], 'created');
});

test('POST / maps a validation error to 400 and does not broadcast', async () => {
  const service = createFakeService({
    createTask: async () => {
      throw new TaskValidationError('title is required');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = (await response.json()) as { error: string };

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'TASK_VALIDATION_ERROR');
  });

  assert.equal(broadcastCalls.length, 0);
});

test('PATCH /:id updates a task and broadcasts "updated"', async () => {
  const service = createFakeService({
    updateTask: async (id, body) => {
      assert.equal(id, 'task-1');
      assert.deepEqual(body, { stage: 'done' });
      return { ...TASK, stage: 'done' };
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/task-1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: 'done' }),
    });
    const payload = (await response.json()) as { data: { task: TaskRow } };

    assert.equal(response.status, 200);
    assert.equal(payload.data.task.stage, 'done');
  });

  assert.equal(broadcastCalls.length, 1);
  assert.equal(broadcastCalls[0]![1], 'updated');
});

test('PATCH /:id maps a not-found error to 404 and does not broadcast', async () => {
  const service = createFakeService({
    updateTask: async () => {
      throw new TaskNotFoundError('missing-id');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/missing-id`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: 'done' }),
    });
    const payload = (await response.json()) as { error: string };

    assert.equal(response.status, 404);
    assert.equal(payload.error, 'TASK_NOT_FOUND');
  });

  assert.equal(broadcastCalls.length, 0);
});

test('DELETE /:id deletes a task and broadcasts "deleted"', async () => {
  const service = createFakeService({
    deleteTask: (id) => {
      assert.equal(id, 'task-1');
      return TASK;
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/task-1`, { method: 'DELETE' });
    const payload = (await response.json()) as { data: { task: TaskRow } };

    assert.equal(response.status, 200);
    assert.equal(payload.data.task.id, 'task-1');
  });

  assert.equal(broadcastCalls.length, 1);
  assert.equal(broadcastCalls[0]![1], 'deleted');
});

test('DELETE /:id maps a not-found error to 404 and does not broadcast', async () => {
  const service = createFakeService({
    deleteTask: () => {
      throw new TaskNotFoundError('missing-id');
    },
  });
  const broadcastCalls: Array<[TaskRow, TaskUpdateAction]> = [];

  await withTasksServer(service, broadcastCalls, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tasks/missing-id`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  });

  assert.equal(broadcastCalls.length, 0);
});
