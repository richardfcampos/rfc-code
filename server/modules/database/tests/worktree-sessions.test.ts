import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';

type ColumnInfoRow = { name: string };

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'worktree-sessions-'));
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

const columnNames = (table: string): string[] =>
  (getConnection().prepare(`PRAGMA table_info(${table})`).all() as ColumnInfoRow[]).map(
    (column) => column.name,
  );

test('migration adds worktree_path column to sessions', async () => {
  await withIsolatedDatabase(() => {
    assert.ok(columnNames('sessions').includes('worktree_path'));
  });
});

test('migration adds worktree_branch column to sessions', async () => {
  await withIsolatedDatabase(() => {
    assert.ok(columnNames('sessions').includes('worktree_branch'));
  });
});

test('migration is idempotent: running it twice does not fail', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    // Run migrations once already done by initializeDatabase
    // Now run them again manually to verify idempotence
    runMigrations(db);

    // Both columns should exist and be queryable
    const columns = columnNames('sessions');
    assert.ok(columns.includes('worktree_path'));
    assert.ok(columns.includes('worktree_branch'));
  });
});

test('existing sessions have worktree_path and worktree_branch as NULL', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    // Create a project first (sessions have FOREIGN KEY constraint on project_path)
    db.prepare(
      `INSERT INTO projects (project_id, project_path) VALUES ('proj-1', '/repo')`
    ).run();

    // Create a session with standard behavior (no worktree)
    db.prepare(
      `INSERT INTO sessions (session_id, provider, project_path) VALUES ('session-1', 'claude', '/repo')`
    ).run();

    const row = db
      .prepare('SELECT worktree_path, worktree_branch FROM sessions WHERE session_id = ?')
      .get('session-1') as { worktree_path: string | null; worktree_branch: string | null };

    assert.equal(row.worktree_path, null);
    assert.equal(row.worktree_branch, null);
  });
});

test('sessions can store and retrieve worktree_path and worktree_branch values', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    // Create a project first (sessions have FOREIGN KEY constraint on project_path)
    db.prepare(
      `INSERT INTO projects (project_id, project_path) VALUES ('proj-wt', '/repo')`
    ).run();

    // Create a session with worktree context
    db.prepare(
      `INSERT INTO sessions (session_id, provider, project_path, worktree_path, worktree_branch)
       VALUES ('session-wt', 'claude', '/repo', '/repo-worktrees/feature-branch', 'feature-branch')`
    ).run();

    const row = db
      .prepare('SELECT worktree_path, worktree_branch FROM sessions WHERE session_id = ?')
      .get('session-wt') as { worktree_path: string | null; worktree_branch: string | null };

    assert.equal(row.worktree_path, '/repo-worktrees/feature-branch');
    assert.equal(row.worktree_branch, 'feature-branch');
  });
});
