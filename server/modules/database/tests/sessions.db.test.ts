import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-worktree-'));
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

function countProjectRows(): number {
  const db = getConnection();
  const row = db.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number };
  return row.count;
}

test('createSession stores the resolved worktree_path/worktree_branch pair', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'provider-wt-1',
      'claude',
      '/repo',
      'Worktree Session',
      undefined,
      undefined,
      '/fake/provider-wt-1.jsonl',
      null,
      '/repo-worktrees/feature-a',
      'feature-a'
    );

    const row = sessionsDb.getSessionById('provider-wt-1');
    assert.equal(row?.project_path, '/repo');
    assert.equal(row?.worktree_path, '/repo-worktrees/feature-a');
    assert.equal(row?.worktree_branch, 'feature-a');
  });
});

test('createSession never creates a project row for the worktree directory', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'provider-wt-2',
      'claude',
      '/repo',
      'Worktree Session',
      undefined,
      undefined,
      '/fake/provider-wt-2.jsonl',
      null,
      '/repo-worktrees/feature-b',
      'feature-b'
    );

    // Only the parent repo path gets a project row; the worktree path never does.
    assert.equal(countProjectRows(), 1);

    const db = getConnection();
    const projectRows = db.prepare('SELECT project_path FROM projects').all() as {
      project_path: string;
    }[];
    assert.deepEqual(
      projectRows.map((r) => r.project_path),
      ['/repo']
    );
  });
});

test('a re-sync UPDATE overwrites worktree_branch with the latest resolution', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'provider-wt-3',
      'claude',
      '/repo',
      'Worktree Session',
      undefined,
      undefined,
      '/fake/provider-wt-3.jsonl',
      null,
      '/repo-worktrees/feature-c',
      'feature-c'
    );

    // Same provider_session_id + provider hits the UPDATE branch, not INSERT.
    sessionsDb.createSession(
      'provider-wt-3',
      'claude',
      '/repo',
      'Worktree Session',
      undefined,
      undefined,
      '/fake/provider-wt-3.jsonl',
      null,
      '/repo-worktrees/feature-c',
      'renamed-branch'
    );

    const row = sessionsDb.getSessionById('provider-wt-3');
    assert.equal(row?.worktree_branch, 'renamed-branch');
  });
});

test('a re-sync UPDATE clears the worktree pair back to NULL when the session left the worktree', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'provider-wt-4',
      'claude',
      '/repo',
      'Worktree Session',
      undefined,
      undefined,
      '/fake/provider-wt-4.jsonl',
      null,
      '/repo-worktrees/feature-d',
      'feature-d'
    );

    // Next resolution says this cwd is the main worktree again: overwrite, not COALESCE.
    sessionsDb.createSession(
      'provider-wt-4',
      'claude',
      '/repo',
      'Worktree Session',
      undefined,
      undefined,
      '/fake/provider-wt-4.jsonl'
    );

    const row = sessionsDb.getSessionById('provider-wt-4');
    assert.equal(row?.worktree_path, null);
    assert.equal(row?.worktree_branch, null);
  });
});

test('legacy callers that omit the worktree args still compile and persist NULL', async () => {
  await withIsolatedDatabase(() => {
    // Mirrors the current call shape used by the provider synchronizers,
    // which do not resolve worktree context yet (a separate task wires that up).
    sessionsDb.createSession('provider-legacy-1', 'claude', '/repo', 'Legacy Session');

    const row = sessionsDb.getSessionById('provider-legacy-1');
    assert.equal(row?.worktree_path, null);
    assert.equal(row?.worktree_branch, null);
  });
});

test('createAppSession stores the resolved worktree pair and only registers the parent project', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession(
      'app-wt-1',
      'claude',
      '/repo',
      null,
      '/repo-worktrees/feature-e',
      'feature-e'
    );

    const row = sessionsDb.getSessionById('app-wt-1');
    assert.equal(row?.project_path, '/repo');
    assert.equal(row?.worktree_path, '/repo-worktrees/feature-e');
    assert.equal(row?.worktree_branch, 'feature-e');
    assert.equal(countProjectRows(), 1);
  });
});

test('createAppSession without worktree args keeps existing NULL behavior', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-wt-2', 'claude', '/repo');

    const row = sessionsDb.getSessionById('app-wt-2');
    assert.equal(row?.worktree_path, null);
    assert.equal(row?.worktree_branch, null);
    assert.equal(row?.custom_name, null);
  });
});

test('createAppSession stamps an explicit custom name at creation', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-named-1', 'claude', '/repo', null, null, null, 'Automated follow-up');

    const row = sessionsDb.getSessionById('app-named-1');
    assert.equal(row?.custom_name, 'Automated follow-up');
  });
});

test('createAppSession omitting the trailing custom name still persists NULL', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-named-2', 'claude', '/repo', null, '/repo-wt', 'feature-x');

    const row = sessionsDb.getSessionById('app-named-2');
    assert.equal(row?.custom_name, null);
    // The worktree pair before it is unaffected by the new trailing parameter.
    assert.equal(row?.worktree_path, '/repo-wt');
    assert.equal(row?.worktree_branch, 'feature-x');
  });
});
