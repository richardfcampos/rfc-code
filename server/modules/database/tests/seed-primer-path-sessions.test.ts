import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

type ColumnInfoRow = { name: string };

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'seed-primer-path-sessions-'));
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

test('migration adds seed_primer_path column to sessions', async () => {
  await withIsolatedDatabase(() => {
    assert.ok(columnNames('sessions').includes('seed_primer_path'));
  });
});

test('migration is idempotent: running it twice does not fail', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    runMigrations(db);

    assert.ok(columnNames('sessions').includes('seed_primer_path'));
  });
});

test('a pre-migration sessions table gains seed_primer_path with existing rows preserved as NULL', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    // Simulate a database created before this migration existed: the current
    // sessions schema minus the seed_primer_path column, with a pre-existing
    // row already in it.
    db.exec('DROP TABLE sessions');
    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        provider_session_id TEXT,
        custom_name TEXT,
        project_path TEXT,
        jsonl_path TEXT,
        profile_id TEXT,
        caveman_mode TEXT,
        worktree_path TEXT,
        worktree_branch TEXT,
        isArchived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id)
      )
    `);

    db.prepare(
      `INSERT INTO projects (project_id, project_path) VALUES ('proj-legacy', '/repo-legacy')`
    ).run();
    db.prepare(
      `INSERT INTO sessions (session_id, provider, project_path, custom_name)
       VALUES ('session-legacy', 'claude', '/repo-legacy', 'Legacy Session')`
    ).run();

    assert.ok(!columnNames('sessions').includes('seed_primer_path'));

    runMigrations(db);

    assert.ok(columnNames('sessions').includes('seed_primer_path'));

    const row = db
      .prepare(
        'SELECT session_id, custom_name, seed_primer_path FROM sessions WHERE session_id = ?'
      )
      .get('session-legacy') as {
      session_id: string;
      custom_name: string | null;
      seed_primer_path: string | null;
    };

    assert.equal(row.session_id, 'session-legacy');
    assert.equal(row.custom_name, 'Legacy Session');
    assert.equal(row.seed_primer_path, null);
  });
});

test('createAppSession leaves seed_primer_path NULL', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-app-1', 'claude', '/workspace/demo-project');

    const row = sessionsDb.getSessionById('session-app-1');
    assert.equal(row?.seed_primer_path, null);
  });
});

test('SESSION_ROW_COLUMNS selects seed_primer_path once populated', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-app-2', 'claude', '/workspace/demo-project');

    const db = getConnection();
    db.prepare('UPDATE sessions SET seed_primer_path = ? WHERE session_id = ?').run(
      '/tmp/primer-session-app-2.md',
      'session-app-2',
    );

    const row = sessionsDb.getSessionById('session-app-2');
    assert.equal(row?.seed_primer_path, '/tmp/primer-session-app-2.md');
  });
});

test('updateSessionSeedPrimerPath sets the path and advances updated_at', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('session-setter-1', 'claude', '/workspace/demo-project');

    const before = sessionsDb.getSessionById('session-setter-1');
    assert.equal(before?.seed_primer_path, null);

    // Ensure CURRENT_TIMESTAMP (second resolution) has a chance to move forward.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    sessionsDb.updateSessionSeedPrimerPath('session-setter-1', '/tmp/primer-setter-1.md');

    const after = sessionsDb.getSessionById('session-setter-1');
    assert.equal(after?.seed_primer_path, '/tmp/primer-setter-1.md');
    assert.ok(before && after);
    assert.notEqual(after?.updated_at, before?.updated_at);
  });
});

test('updateSessionSeedPrimerPath clears the path when passed null', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-setter-2', 'claude', '/workspace/demo-project');

    sessionsDb.updateSessionSeedPrimerPath('session-setter-2', '/tmp/primer-setter-2.md');
    const populated = sessionsDb.getSessionById('session-setter-2');
    assert.equal(populated?.seed_primer_path, '/tmp/primer-setter-2.md');

    sessionsDb.updateSessionSeedPrimerPath('session-setter-2', null);
    const cleared = sessionsDb.getSessionById('session-setter-2');
    assert.equal(cleared?.seed_primer_path, null);
  });
});

test('updateSessionSeedPrimerPath does not affect an unrelated session row', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-setter-target', 'claude', '/workspace/demo-project');
    sessionsDb.createAppSession('session-setter-bystander', 'claude', '/workspace/demo-project');

    sessionsDb.updateSessionSeedPrimerPath(
      'session-setter-target',
      '/tmp/primer-setter-target.md',
    );

    const target = sessionsDb.getSessionById('session-setter-target');
    const bystander = sessionsDb.getSessionById('session-setter-bystander');

    assert.equal(target?.seed_primer_path, '/tmp/primer-setter-target.md');
    assert.equal(bystander?.seed_primer_path, null);
  });
});
