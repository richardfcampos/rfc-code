import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  emitTaskStageChanged,
  registerTaskStageListener,
  type TaskStageChangedEvent,
} from '@/modules/tasks/task-stage-listeners.js';
import { createTasksService } from '@/modules/tasks/tasks.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'task-stage-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

/** Subscribes for the duration of one test and always unsubscribes. */
async function withListener(
  run: (events: TaskStageChangedEvent[]) => Promise<void>,
  listener?: (event: TaskStageChangedEvent) => void,
): Promise<void> {
  const events: TaskStageChangedEvent[] = [];
  const unsubscribe = registerTaskStageListener((event) => {
    events.push(event);
    listener?.(event);
  });

  try {
    await run(events);
  } finally {
    unsubscribe();
  }
}

test('moving a task to another stage announces the transition', async () => {
  await withIsolatedDatabase(async () => {
    const service = createTasksService({ assertAssigneeAllowed: () => {} });
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    await withListener(async (events) => {
      await service.updateTask(task.id, { stage: 'in_progress' });

      assert.equal(events.length, 1);
      assert.equal(events[0].task.id, task.id);
      assert.equal(events[0].task.stage, 'in_progress');
      assert.equal(events[0].previousStage, 'backlog');
    });
  });
});

test('an update that does not move the task announces nothing', async () => {
  await withIsolatedDatabase(async () => {
    const service = createTasksService({ assertAssigneeAllowed: () => {} });
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    await withListener(async (events) => {
      await service.updateTask(task.id, { title: 'Ship it faster' });
      // Re-sending the stage the task is already on is not a transition.
      await service.updateTask(task.id, { stage: 'backlog' });

      assert.deepEqual(events, []);
    });
  });
});

test('a failed update never announces a transition that did not happen', async () => {
  await withIsolatedDatabase(async () => {
    const service = createTasksService({ assertAssigneeAllowed: () => {} });

    await withListener(async (events) => {
      await assert.rejects(() => service.updateTask('missing', { stage: 'done' }));
      assert.deepEqual(events, []);
    });
  });
});

test('unsubscribing stops delivery', async () => {
  const events: TaskStageChangedEvent[] = [];
  const unsubscribe = registerTaskStageListener((event) => {
    events.push(event);
  });
  unsubscribe();

  emitTaskStageChanged({ task: { id: 'task-1' } as TaskStageChangedEvent['task'], previousStage: 'backlog' });

  assert.deepEqual(events, []);
});

test('a listener that throws does not stop the others, or the caller', async () => {
  const delivered: string[] = [];
  const unsubscribeBroken = registerTaskStageListener(() => {
    throw new Error('listener exploded');
  });
  const unsubscribeRejecting = registerTaskStageListener(async () => {
    throw new Error('listener rejected');
  });
  const unsubscribeFine = registerTaskStageListener(() => {
    delivered.push('fine');
  });

  try {
    emitTaskStageChanged({ task: { id: 'task-1' } as TaskStageChangedEvent['task'], previousStage: null });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(delivered, ['fine']);
  } finally {
    unsubscribeBroken();
    unsubscribeRejecting();
    unsubscribeFine();
  }
});
