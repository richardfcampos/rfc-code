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
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'profiles-schema-'));
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

const tableExists = (name: string): boolean =>
  Boolean(
    getConnection()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );

const columnNames = (table: string): string[] =>
  (getConnection().prepare(`PRAGMA table_info(${table})`).all() as ColumnInfoRow[]).map(
    (column) => column.name,
  );

test('migration creates the profiles table with the specified columns', async () => {
  await withIsolatedDatabase(() => {
    assert.equal(tableExists('profiles'), true);

    const columns = columnNames('profiles');
    for (const expected of ['id', 'provider', 'name', 'slug', 'created_at']) {
      assert.ok(columns.includes(expected), `profiles is missing column "${expected}"`);
    }
  });
});

test('migration adds a nullable profile_id column to sessions', async () => {
  await withIsolatedDatabase(() => {
    assert.ok(columnNames('sessions').includes('profile_id'));

    // A session inserted without a profile keeps profile_id NULL — this is the
    // pre-feature (upstream) behavior that must remain intact.
    const db = getConnection();
    db.prepare(
      `INSERT INTO sessions (session_id, provider, project_path) VALUES ('legacy', 'claude', NULL)`,
    ).run();
    const row = db
      .prepare('SELECT profile_id FROM sessions WHERE session_id = ?')
      .get('legacy') as { profile_id: string | null };
    assert.equal(row.profile_id, null);
  });
});

test('the (provider, slug) pair is unique so two profiles never share a config dir', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    db.prepare(
      `INSERT INTO profiles (id, provider, name, slug) VALUES ('p1', 'claude', 'Account A', 'account-a')`,
    ).run();

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO profiles (id, provider, name, slug) VALUES ('p2', 'claude', 'Duplicate', 'account-a')`,
          )
          .run(),
      /UNIQUE/,
    );

    // Same slug under a different provider is allowed — isolation is per provider.
    assert.doesNotThrow(() =>
      db
        .prepare(
          `INSERT INTO profiles (id, provider, name, slug) VALUES ('p3', 'codex', 'Codex A', 'account-a')`,
        )
        .run(),
    );
  });
});

test('running migrations twice is idempotent and preserves existing rows', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    db.prepare(
      `INSERT INTO profiles (id, provider, name, slug) VALUES ('keep', 'claude', 'Keep Me', 'keep-me')`,
    ).run();

    const profilesColumnsBefore = columnNames('profiles');
    const sessionsColumnsBefore = columnNames('sessions');

    assert.doesNotThrow(() => {
      runMigrations(db);
      runMigrations(db);
    });

    assert.deepEqual(columnNames('profiles'), profilesColumnsBefore);
    assert.deepEqual(columnNames('sessions'), sessionsColumnsBefore);

    const surviving = db.prepare('SELECT name FROM profiles WHERE id = ?').get('keep') as
      | { name: string }
      | undefined;
    assert.equal(surviving?.name, 'Keep Me');
  });
});
