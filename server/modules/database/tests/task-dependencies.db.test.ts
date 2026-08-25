/**
 * Storage-level tests for task decomposition.
 *
 * The interesting parts are the ones a service layer cannot fix after the
 * fact: the batch is atomic, the parent link cascades, and "ready" means every
 * dependency is done — not merely started.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { taskDependenciesDb } from '@/modules/database/repositories/task-dependencies.db.js';
import { tasksDb, type TaskRow } from '@/modules/database/repositories/tasks.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'task-deps-db-'));
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

function createParent(title = 'Ship the importer'): TaskRow {
  return tasksDb.create({ title, projectName: 'my-app' });
}

/** A → B → C chain: index 1 waits on 0, index 2 waits on 1. */
function createChain(parentId: string) {
  return taskDependenciesDb.createDecomposition({
    parentTaskId: parentId,
    projectName: 'my-app',
    originDetail: 'session-maestro',
    subtasks: [
      { title: 'Parse the CSV', dependsOn: [] },
      { title: 'Map to entities', dependsOn: [0] },
      { title: 'Write the loader', dependsOn: [1] },
    ],
  });
}

test('a decomposition creates every subtask under the parent, in plan order', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();
    const subtasks = createChain(parent.id);

    assert.deepEqual(
      subtasks.map((task) => task.title),
      ['Parse the CSV', 'Map to entities', 'Write the loader'],
    );
    for (const subtask of subtasks) {
      assert.equal(subtask.parent_task_id, parent.id);
      assert.equal(subtask.project_name, 'my-app');
      assert.equal(subtask.stage, 'backlog');
      assert.equal(subtask.origin, 'agent');
      assert.equal(subtask.origin_detail, 'session-maestro');
    }

    const edges = taskDependenciesDb.listDependencies(parent.id);
    assert.equal(edges.length, 2);
    assert.equal(edges[0].task_id, subtasks[1].id);
    assert.equal(edges[0].depends_on_task_id, subtasks[0].id);
  });
});

test('a subtask carries its optional description and suggested skill', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();
    const [subtask] = taskDependenciesDb.createDecomposition({
      parentTaskId: parent.id,
      projectName: 'my-app',
      subtasks: [
        {
          title: 'Parse the CSV',
          description: 'Streaming parser, no full read into memory.',
          suggestedSkill: 'backend-development',
          dependsOn: [],
        },
      ],
    });

    assert.equal(subtask.description, 'Streaming parser, no full read into memory.');
    assert.equal(subtask.suggested_skill, 'backend-development');
  });
});

test('a failing edge rolls the whole batch back, leaving no orphan subtasks', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();

    assert.throws(
      () =>
        taskDependenciesDb.createDecomposition({
          parentTaskId: parent.id,
          projectName: 'my-app',
          subtasks: [
            { title: 'First', dependsOn: [] },
            // A self-dependency violates the table CHECK; the tasks inserted
            // before it must not survive the failure.
            { title: 'Second', dependsOn: [1] },
          ],
        }),
      /CHECK constraint failed/,
    );

    assert.deepEqual(taskDependenciesDb.listSubtasks(parent.id), []);
    assert.deepEqual(taskDependenciesDb.listDependencies(parent.id), []);
  });
});

test('a repeated edge is refused rather than silently collapsed', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();

    assert.throws(
      () =>
        taskDependenciesDb.createDecomposition({
          parentTaskId: parent.id,
          projectName: 'my-app',
          subtasks: [
            { title: 'First', dependsOn: [] },
            { title: 'Second', dependsOn: [0, 0] },
          ],
        }),
      /UNIQUE constraint failed/,
    );

    assert.deepEqual(taskDependenciesDb.listSubtasks(parent.id), []);
  });
});

test('only the head of a dependency chain is ready, and finishing it releases the next', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();
    const [first, second, third] = createChain(parent.id);

    assert.deepEqual(
      taskDependenciesDb.listReady(parent.id).map((task) => task.id),
      [first.id],
    );

    tasksDb.update(first.id, { stage: 'done' });
    assert.deepEqual(
      taskDependenciesDb.listReady(parent.id).map((task) => task.id),
      [second.id],
    );

    // Review is not done: the third task stays blocked until its blocker lands.
    tasksDb.update(second.id, { stage: 'review' });
    assert.deepEqual(taskDependenciesDb.listReady(parent.id), []);

    tasksDb.update(second.id, { stage: 'done' });
    assert.deepEqual(
      taskDependenciesDb.listReady(parent.id).map((task) => task.id),
      [third.id],
    );
  });
});

test('a subtask already in progress is not offered as ready again', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();
    const [first] = createChain(parent.id);

    tasksDb.update(first.id, { stage: 'in_progress' });
    assert.deepEqual(taskDependenciesDb.listReady(parent.id), []);
  });
});

test('a subtask waiting on two blockers is ready only when both are done', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();
    const [left, right, join] = taskDependenciesDb.createDecomposition({
      parentTaskId: parent.id,
      projectName: 'my-app',
      subtasks: [
        { title: 'Left', dependsOn: [] },
        { title: 'Right', dependsOn: [] },
        { title: 'Join', dependsOn: [0, 1] },
      ],
    });

    assert.deepEqual(
      taskDependenciesDb.listReady(parent.id).map((task) => task.id),
      [left.id, right.id],
    );

    tasksDb.update(left.id, { stage: 'done' });
    assert.deepEqual(
      taskDependenciesDb.listReady(parent.id).map((task) => task.id),
      [right.id],
    );

    tasksDb.update(right.id, { stage: 'done' });
    assert.deepEqual(
      taskDependenciesDb.listReady(parent.id).map((task) => task.id),
      [join.id],
    );
  });
});

test('deleting the parent removes its subtasks and their edges', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();
    const subtasks = createChain(parent.id);

    tasksDb.delete(parent.id);

    assert.equal(tasksDb.get(subtasks[0].id), null);
    const remainingEdges = getConnection()
      .prepare('SELECT COUNT(*) AS total FROM task_dependencies')
      .get() as { total: number };
    assert.equal(remainingEdges.total, 0);
  });
});

test('subtasks of one parent never leak into another parent listing', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();
    const otherParent = createParent('Unrelated work');
    createChain(parent.id);

    assert.deepEqual(taskDependenciesDb.listSubtasks(otherParent.id), []);
    assert.deepEqual(taskDependenciesDb.listReady(otherParent.id), []);
  });
});

test('get reads a task with its parent link, and null for an unknown id', async () => {
  await withIsolatedDatabase(() => {
    const parent = createParent();
    const [first] = createChain(parent.id);

    assert.equal(taskDependenciesDb.get(first.id)?.parent_task_id, parent.id);
    assert.equal(taskDependenciesDb.get(parent.id)?.parent_task_id, null);
    assert.equal(taskDependenciesDb.get('missing-task'), null);
  });
});
