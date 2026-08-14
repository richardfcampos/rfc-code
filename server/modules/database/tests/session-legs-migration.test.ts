import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';

type ColumnInfoRow = { name: string };
type IndexListRow = { name: string; unique: number };
type LegRow = {
  leg_id: string;
  session_id: string;
  seq: number;
  provider: string;
  profile_id: string | null;
  provider_session_id: string | null;
  jsonl_path: string | null;
  profile_name_at_switch: string | null;
  started_at: string;
  ended_at: string | null;
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-legs-migration-'));
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

const indexList = (table: string): IndexListRow[] =>
  getConnection().prepare(`PRAGMA index_list(${table})`).all() as IndexListRow[];

const createProjectAndSession = (
  sessionId: string,
  providerSessionId: string | null,
  projectPath = '/repo',
): void => {
  const db = getConnection();

  db.prepare(
    `INSERT OR IGNORE INTO projects (project_id, project_path) VALUES (?, ?)`
  ).run(`proj-${projectPath}`, projectPath);

  db.prepare(
    `INSERT INTO sessions (session_id, provider, provider_session_id, project_path, jsonl_path, profile_id)
     VALUES (?, 'claude', ?, ?, ?, 'profile-1')`
  ).run(sessionId, providerSessionId, projectPath, providerSessionId ? `/jsonl/${sessionId}.jsonl` : null);
};

test('migration creates the session_legs table with all design columns', async () => {
  await withIsolatedDatabase(() => {
    const expectedColumns = [
      'leg_id',
      'session_id',
      'seq',
      'provider',
      'profile_id',
      'provider_session_id',
      'jsonl_path',
      'profile_name_at_switch',
      'started_at',
      'ended_at',
    ];

    const columns = columnNames('session_legs');
    for (const expected of expectedColumns) {
      assert.ok(columns.includes(expected), `expected session_legs to have column ${expected}`);
    }
  });
});

test('migration creates the session and provider_session indexes', async () => {
  await withIsolatedDatabase(() => {
    const indexes = indexList('session_legs');

    const sessionIndex = indexes.find((index) => index.name === 'idx_session_legs_session');
    assert.ok(sessionIndex);
    assert.equal(sessionIndex?.unique, 0);

    const providerSessionIndex = indexes.find(
      (index) => index.name === 'idx_session_legs_provider_session',
    );
    assert.ok(providerSessionIndex);
    assert.equal(providerSessionIndex?.unique, 1);
  });
});

test('migration is idempotent: running it twice does not fail or duplicate the table', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    runMigrations(db);

    assert.ok(columnNames('session_legs').includes('leg_id'));
  });
});

test('backfill creates exactly one seq = 0 leg per session with a provider_session_id', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    createProjectAndSession('session-with-provider', 'native-abc');

    runMigrations(db);

    const legsWithProvider = db
      .prepare('SELECT * FROM session_legs WHERE session_id = ?')
      .all('session-with-provider') as LegRow[];
    assert.equal(legsWithProvider.length, 1);
    assert.equal(legsWithProvider[0].seq, 0);
    assert.equal(legsWithProvider[0].provider, 'claude');
    assert.equal(legsWithProvider[0].profile_id, 'profile-1');
    assert.equal(legsWithProvider[0].provider_session_id, 'native-abc');
    assert.equal(legsWithProvider[0].jsonl_path, '/jsonl/session-with-provider.jsonl');
  });
});

test('a session created with a NULL provider_session_id is self-mapped before backfill and still gets a leg', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    db.prepare(
      `INSERT OR IGNORE INTO projects (project_id, project_path) VALUES ('proj-null-guard', '/repo-null-guard')`
    ).run();
    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, project_path, profile_id)
       VALUES ('session-null-guard', 'claude', NULL, '/repo-null-guard', 'profile-1')`
    ).run();

    // addProviderSessionIdMapping (an earlier, pre-existing migration step) self-maps any
    // NULL provider_session_id to the session's own id before the leg backfill ever runs,
    // so by the time backfillSessionLegs sees this row, provider_session_id is no longer
    // NULL. This documents that interaction instead of asserting an unreachable NULL case.
    runMigrations(db);

    const session = db
      .prepare('SELECT provider_session_id FROM sessions WHERE session_id = ?')
      .get('session-null-guard') as { provider_session_id: string | null };
    assert.equal(session.provider_session_id, 'session-null-guard');

    const legs = db
      .prepare('SELECT * FROM session_legs WHERE session_id = ?')
      .all('session-null-guard') as LegRow[];
    assert.equal(legs.length, 1);
    assert.equal(legs[0].provider_session_id, 'session-null-guard');
  });
});

test('backfill does not duplicate legs when migrations run twice', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    createProjectAndSession('session-double-run', 'native-double');

    runMigrations(db);
    runMigrations(db);

    const legs = db
      .prepare('SELECT * FROM session_legs WHERE session_id = ?')
      .all('session-double-run') as LegRow[];
    assert.equal(legs.length, 1);
  });
});

test('the provider_session unique index rejects a second leg with the same provider_session_id', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    createProjectAndSession('session-a', 'native-shared');
    createProjectAndSession('session-b', null);

    db.prepare(
      `INSERT INTO session_legs (leg_id, session_id, seq, provider, provider_session_id)
       VALUES ('leg-first', 'session-a', 0, 'claude', 'native-shared')`
    ).run();

    assert.throws(() => {
      db.prepare(
        `INSERT INTO session_legs (leg_id, session_id, seq, provider, provider_session_id)
         VALUES ('leg-dup', 'session-b', 0, 'claude', 'native-shared')`
      ).run();
    });
  });
});
