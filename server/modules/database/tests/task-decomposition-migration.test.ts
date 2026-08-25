/**
 * Upgrade-path tests for task decomposition.
 *
 * A fresh install gets the columns from the schema file, so what needs proving
 * here is the other half: an installation that already has a board gains the
 * parent link and the edge table without losing a task, and re-running the
 * migration is a no-op.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';
import { taskDependenciesDb } from '@/modules/database/repositories/task-dependencies.db.js';

type ColumnInfoRow = { name: string };

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'task-decomposition-migration-'));

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

const columnNames = (table: string): string[] =>
  (getConnection().prepare(`PRAGMA table_info(${table})`).all() as ColumnInfoRow[]).map(
    (column) => column.name,
  );

const tableExists = (table: string): boolean =>
  Boolean(
    getConnection()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );

test('a fresh database has the parent link and the dependency table', async () => {
  await withIsolatedDatabase(() => {
    assert.ok(columnNames('tasks').includes('parent_task_id'));
    assert.ok(tableExists('task_dependencies'));
  });
});

test('running the migration twice changes nothing', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    runMigrations(db);

    assert.ok(columnNames('tasks').includes('parent_task_id'));
    assert.equal(columnNames('tasks').filter((name) => name === 'parent_task_id').length, 1);
    assert.ok(tableExists('task_dependencies'));
  });
});

test('a board that predates decomposition keeps its tasks and gains an empty parent link', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    // The tasks table as it stood before decomposition existed, with a task
    // already on it.
    db.exec('DROP TABLE task_dependencies');
    db.exec('DROP TABLE task_evidence');
    db.exec('DROP TABLE task_attachments');
    db.exec('DROP TABLE tasks');
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        project_name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        stage TEXT NOT NULL DEFAULT 'backlog'
          CHECK (stage IN ('backlog', 'in_progress', 'review', 'done')),
        origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'agent', 'automation')),
        origin_detail TEXT,
        assignee_profile_id TEXT,
        suggested_skill TEXT,
        worktree_branch TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.prepare(
      `INSERT INTO tasks (id, project_name, title, stage) VALUES ('task-legacy', 'my-app', 'Old work', 'review')`,
    ).run();

    assert.ok(!columnNames('tasks').includes('parent_task_id'));
    assert.ok(!tableExists('task_dependencies'));

    runMigrations(db);

    assert.ok(tableExists('task_dependencies'));
    const legacy = taskDependenciesDb.get('task-legacy');
    assert.equal(legacy?.title, 'Old work');
    assert.equal(legacy?.stage, 'review');
    // A task nobody broke down is simply a task with no parent.
    assert.equal(legacy?.parent_task_id, null);
  });
});

test('the upgraded schema still enforces the dependency constraints', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    db.prepare(
      `INSERT INTO tasks (id, project_name, title) VALUES ('task-a', 'my-app', 'A')`,
    ).run();

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ('task-a', 'task-a')`,
          )
          .run(),
      /CHECK constraint failed/,
    );

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ('task-a', 'task-missing')`,
          )
          .run(),
      /FOREIGN KEY constraint failed/,
    );
  });
});
