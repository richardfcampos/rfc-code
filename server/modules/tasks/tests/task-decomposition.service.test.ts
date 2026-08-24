/**
 * Service tests for task decomposition.
 *
 * Runs against a real (temporary) database because the guarantees under test
 * are about what does or does not end up stored: a rejected plan must leave
 * nothing behind, and "ready" must follow the dependency chain.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, tasksDb } from '@/modules/database/index.js';
import {
  createTaskDecompositionService,
  MAX_SUBTASKS_PER_DECOMPOSITION,
  type TaskDecompositionService,
} from '@/modules/tasks/services/task-decomposition.service.js';
import { AppError } from '@/shared/utils.js';

async function withService(
  runTest: (service: TaskDecompositionService) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'task-decomposition-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest(createTaskDecompositionService());
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function createParent() {
  return tasksDb.create({ title: 'Ship the importer', projectName: 'my-app' });
}

function expectAppError(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
    return error;
  }
  throw new assert.AssertionError({ message: 'expected the call to throw' });
}

test('decompose stores the plan and inherits the parent project', async () => {
  await withService((service) => {
    const parent = createParent();

    const result = service.decompose(parent.id, {
      origin_detail: 'session-maestro',
      subtasks: [
        { title: 'Parse the CSV', description: 'Streaming only', skill: 'backend-development' },
        { title: 'Write the loader', dependsOn: [0] },
      ],
    });

    assert.equal(result.parent.id, parent.id);
    assert.equal(result.subtasks.length, 2);
    assert.equal(result.subtasks[0].project_name, parent.project_name);
    assert.equal(result.subtasks[0].parent_task_id, parent.id);
    assert.equal(result.subtasks[0].suggested_skill, 'backend-development');
    assert.equal(result.subtasks[0].description, 'Streaming only');
    assert.equal(result.subtasks[0].origin, 'agent');
    assert.equal(result.subtasks[0].origin_detail, 'session-maestro');
    assert.deepEqual(result.dependencies, [
      {
        task_id: result.subtasks[1].id,
        depends_on_task_id: result.subtasks[0].id,
        created_at: result.dependencies[0].created_at,
      },
    ]);
  });
});

test('a project named in the request body cannot move subtasks to another board', async () => {
  await withService((service) => {
    const parent = createParent();

    const result = service.decompose(parent.id, {
      project: 'somebody-elses-app',
      subtasks: [{ title: 'Parse the CSV' }],
    });

    assert.equal(result.subtasks[0].project_name, 'my-app');
  });
});

test('decomposing an unknown parent is a 404', async () => {
  await withService((service) => {
    const error = expectAppError(() =>
      service.decompose('missing-task', { subtasks: [{ title: 'Anything' }] }),
    );
    assert.equal(error.code, 'TASK_NOT_FOUND');
    assert.equal(error.statusCode, 404);
  });
});

test('a subtask cannot itself be decomposed', async () => {
  await withService((service) => {
    const parent = createParent();
    const { subtasks } = service.decompose(parent.id, { subtasks: [{ title: 'Parse the CSV' }] });

    const error = expectAppError(() =>
      service.decompose(subtasks[0].id, { subtasks: [{ title: 'Deeper' }] }),
    );
    assert.equal(error.code, 'TASK_VALIDATION_ERROR');
    assert.match(error.message, /already a subtask/);
  });
});

test('an empty or oversized plan is refused', async () => {
  await withService((service) => {
    const parent = createParent();

    assert.equal(expectAppError(() => service.decompose(parent.id, {})).code, 'TASK_VALIDATION_ERROR');
    assert.equal(
      expectAppError(() => service.decompose(parent.id, { subtasks: [] })).code,
      'TASK_VALIDATION_ERROR',
    );

    const tooMany = Array.from({ length: MAX_SUBTASKS_PER_DECOMPOSITION + 1 }, (_unused, index) => ({
      title: `Step ${index}`,
    }));
    assert.match(
      expectAppError(() => service.decompose(parent.id, { subtasks: tooMany })).message,
      /at most/,
    );
  });
});

test('an out-of-range dependency index is refused and nothing is stored', async () => {
  await withService((service) => {
    const parent = createParent();

    const error = expectAppError(() =>
      service.decompose(parent.id, {
        subtasks: [{ title: 'First' }, { title: 'Second', dependsOn: [5] }],
      }),
    );

    assert.equal(error.code, 'TASK_VALIDATION_ERROR');
    assert.match(error.message, /between 0 and 1/);
    assert.deepEqual(service.getDecomposition(parent.id).subtasks, []);
  });
});

test('a self-dependency is refused before any row is written', async () => {
  await withService((service) => {
    const parent = createParent();

    const error = expectAppError(() =>
      service.decompose(parent.id, { subtasks: [{ title: 'First', dependsOn: [0] }] }),
    );

    assert.match(error.message, /cannot depend on itself/);
    assert.deepEqual(service.getDecomposition(parent.id).subtasks, []);
  });
});

test('a dependency cycle is refused, since nothing in it could ever start', async () => {
  await withService((service) => {
    const parent = createParent();

    const error = expectAppError(() =>
      service.decompose(parent.id, {
        subtasks: [
          { title: 'First', dependsOn: [2] },
          { title: 'Second', dependsOn: [0] },
          { title: 'Third', dependsOn: [1] },
        ],
      }),
    );

    assert.match(error.message, /cycle \(indices: 0, 1, 2\)/);
    assert.deepEqual(service.getDecomposition(parent.id).subtasks, []);
  });
});

test('a repeated dependency index is collapsed into one edge', async () => {
  await withService((service) => {
    const parent = createParent();

    const result = service.decompose(parent.id, {
      subtasks: [{ title: 'First' }, { title: 'Second', dependsOn: [0, 0] }],
    });

    assert.equal(result.dependencies.length, 1);
  });
});

test('an invalid title in the middle of a plan aborts the whole decomposition', async () => {
  await withService((service) => {
    const parent = createParent();

    expectAppError(() =>
      service.decompose(parent.id, {
        subtasks: [{ title: 'First' }, { title: '   ' }, { title: 'Third' }],
      }),
    );

    assert.deepEqual(service.getDecomposition(parent.id).subtasks, []);
    assert.deepEqual(service.getDecomposition(parent.id).dependencies, []);
  });
});

test('listReady walks the chain as subtasks finish', async () => {
  await withService((service) => {
    const parent = createParent();
    const { subtasks } = service.decompose(parent.id, {
      subtasks: [
        { title: 'First' },
        { title: 'Second', dependsOn: [0] },
        { title: 'Third', dependsOn: [0] },
      ],
    });

    assert.deepEqual(service.listReady(parent.id).map((task) => task.id), [subtasks[0].id]);

    tasksDb.update(subtasks[0].id, { stage: 'done' });
    assert.deepEqual(
      service.listReady(parent.id).map((task) => task.id),
      [subtasks[1].id, subtasks[2].id],
    );
  });
});

test('listReady on an unknown parent is a 404, not an empty list', async () => {
  await withService((service) => {
    const error = expectAppError(() => service.listReady('missing-task'));
    assert.equal(error.statusCode, 404);
  });
});
