import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  createTasksService,
  TaskNotFoundError,
  TaskValidationError,
  type AssertAssigneeAllowed,
} from '@/modules/tasks/tasks.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'tasks-service-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
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

function insertProfile(id: string, name: string): void {
  getConnection()
    .prepare('INSERT INTO profiles (id, provider, name, slug) VALUES (?, ?, ?, ?)')
    .run(id, 'claude', name, id);
}

function createService(assertAssigneeAllowed: AssertAssigneeAllowed = () => {}) {
  return createTasksService({ assertAssigneeAllowed });
}

test('createTask rejects an empty title', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(
      () => service.createTask({ title: '   ', project: 'my-app' }),
      TaskValidationError,
    );
  });
});

test('createTask rejects a title over 500 characters', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(
      () => service.createTask({ title: 'a'.repeat(501), project: 'my-app' }),
      TaskValidationError,
    );
  });
});

test('createTask accepts a title at exactly 500 characters', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'a'.repeat(500), project: 'my-app' });
    assert.equal(task.title.length, 500);
  });
});

test('createTask rejects a missing project', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(
      () => service.createTask({ title: 'Ship it' }),
      TaskValidationError,
    );
  });
});

test('createTask rejects an invalid origin', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(
      () => service.createTask({ title: 'Ship it', project: 'my-app', origin: 'robot' }),
      TaskValidationError,
    );
  });
});

test('createTask defaults stage to backlog and origin to user', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    assert.equal(task.stage, 'backlog');
    assert.equal(task.origin, 'user');
    assert.equal(task.description, null);
  });
});

test('createTask calls the assignee hook when an assignee is set', async () => {
  await withIsolatedDatabase(async () => {
    insertProfile('profile-a', 'Alice');
    const calls: Array<[string, string]> = [];
    const service = createService((project, profileId) => {
      calls.push([project, profileId]);
    });

    const task = await service.createTask({
      title: 'Ship it',
      project: 'my-app',
      assignee_profile_id: 'profile-a',
    });

    assert.equal(task.assignee_profile_id, 'profile-a');
    assert.deepEqual(calls, [['my-app', 'profile-a']]);
  });
});

test('createTask does not call the assignee hook when no assignee is set', async () => {
  await withIsolatedDatabase(async () => {
    let called = false;
    const service = createService(() => {
      called = true;
    });

    await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.equal(called, false);
  });
});

test('createTask propagates a rejection from the assignee hook', async () => {
  await withIsolatedDatabase(async () => {
    insertProfile('profile-a', 'Alice');
    const service = createService(() => {
      throw new Error('assignee not allowed');
    });

    await assert.rejects(
      () => service.createTask({
        title: 'Ship it',
        project: 'my-app',
        assignee_profile_id: 'profile-a',
      }),
      /assignee not allowed/,
    );
  });
});

test('listTasks rejects a missing project', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    assert.throws(() => service.listTasks(undefined), TaskValidationError);
  });
});

test('listTasks returns only tasks for the requested project', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await service.createTask({ title: 'Task A', project: 'my-app' });
    await service.createTask({ title: 'Task B', project: 'other-app' });

    const tasks = service.listTasks('my-app');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.title, 'Task A');
  });
});

test('updateTask rejects an unknown task id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(() => service.updateTask('missing-id', { stage: 'done' }), TaskNotFoundError);
  });
});

test('updateTask rejects an invalid stage', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    await assert.rejects(() => service.updateTask(task.id, { stage: 'shipped' }), TaskValidationError);
  });
});

test('updateTask rejects an empty title', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    await assert.rejects(() => service.updateTask(task.id, { title: '  ' }), TaskValidationError);
  });
});

test('updateTask applies a partial update and calls the assignee hook only for the changed field', async () => {
  await withIsolatedDatabase(async () => {
    insertProfile('profile-a', 'Alice');
    const calls: Array<[string, string]> = [];
    const service = createService((project, profileId) => {
      calls.push([project, profileId]);
    });

    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    const updated = await service.updateTask(task.id, {
      stage: 'in_progress',
      assignee_profile_id: 'profile-a',
    });

    assert.equal(updated.stage, 'in_progress');
    assert.equal(updated.assignee_profile_id, 'profile-a');
    assert.deepEqual(calls, [['my-app', 'profile-a']]);
  });
});

test('updateTask clears the assignee when assignee_profile_id is set to null and skips the hook', async () => {
  await withIsolatedDatabase(async () => {
    insertProfile('profile-a', 'Alice');
    let called = false;
    const service = createService(() => {
      called = true;
    });

    const task = await service.createTask({
      title: 'Ship it',
      project: 'my-app',
      assignee_profile_id: 'profile-a',
    });
    called = false;

    const updated = await service.updateTask(task.id, { assignee_profile_id: null });

    assert.equal(updated.assignee_profile_id, null);
    assert.equal(called, false);
  });
});

test('deleteTask rejects an unknown task id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    assert.throws(() => service.deleteTask('missing-id'), TaskNotFoundError);
  });
});

test('deleteTask removes the task and returns the deleted row', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    const deleted = service.deleteTask(task.id);

    assert.equal(deleted.id, task.id);
    assert.equal(service.listTasks('my-app').length, 0);
  });
});
