/**
 * The upgrade path for a database that already holds collaborations.
 *
 * The council contract added six columns across two tables, and the only
 * interesting question about them is what happens to the rows that were there
 * first: a run recorded by an older build must survive the migration untouched.
 * The columns are dropped here and the migration re-run, which is as close to
 * that build as this suite can get.
 *
 * Read-path behaviour — what a NULL budget resolves to, what an absent contract
 * maps to — belongs to the collab module and is asserted in its own suite.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';

type ColumnInfoRow = { name: string };
type LegacyCollaborationRow = {
  id: string;
  verdict: string | null;
  budget: string | null;
  summary: string | null;
};
type LegacyTurnRow = {
  content: string;
  consensus: number | null;
  contract: string | null;
  contract_error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

const COLLABORATION_COLUMNS = ['budget', 'summary'];
const TURN_COLUMNS = ['contract', 'contract_error', 'input_tokens', 'output_tokens'];

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'council-migration-'));

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

/** Rewinds the schema to what a build before the council contract shipped. */
function dropCouncilColumns(): void {
  const db = getConnection();
  for (const column of COLLABORATION_COLUMNS) {
    db.exec(`ALTER TABLE collaborations DROP COLUMN ${column}`);
  }
  for (const column of TURN_COLUMNS) {
    db.exec(`ALTER TABLE collaboration_turns DROP COLUMN ${column}`);
  }
}

function seedLegacyRun(): void {
  const db = getConnection();
  db.prepare(
    `INSERT INTO collaborations
       (id, topic, mode, project_path, status, max_rounds, current_round, participants, verdict)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'legacy-1',
    'Should we keep SQLite?',
    'debate',
    '/workspace/demo',
    'exhausted',
    3,
    3,
    JSON.stringify([{ profileId: 'profile-a', provider: 'claude', role: 'participant' }]),
    'We kept it.',
  );
  db.prepare(
    `INSERT INTO collaboration_turns
       (id, collaboration_id, round, turn_index, profile_id, role, content, consensus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('legacy-turn-1', 'legacy-1', 1, 0, 'profile-a', 'participant', 'A position.', 1);
}

test('the migration adds every council column to a database that predates them', async () => {
  await withIsolatedDatabase(() => {
    dropCouncilColumns();
    for (const column of COLLABORATION_COLUMNS) {
      assert.ok(!columnNames('collaborations').includes(column), `${column} should be gone`);
    }

    runMigrations(getConnection());

    for (const column of COLLABORATION_COLUMNS) {
      assert.ok(columnNames('collaborations').includes(column), `${column} was not added`);
    }
    for (const column of TURN_COLUMNS) {
      assert.ok(columnNames('collaboration_turns').includes(column), `${column} was not added`);
    }

    // Idempotent: a second boot must not fail on columns that already exist.
    assert.doesNotThrow(() => runMigrations(getConnection()));
  });
});

test('a run recorded before the council contract survives the migration untouched', async () => {
  await withIsolatedDatabase(() => {
    dropCouncilColumns();
    seedLegacyRun();
    runMigrations(getConnection());

    const collaboration = getConnection()
      .prepare('SELECT id, verdict, budget, summary FROM collaborations WHERE id = ?')
      .get('legacy-1') as LegacyCollaborationRow;

    assert.equal(collaboration.verdict, 'We kept it.');
    // The new columns are NULL, which is how the read path recognises a row
    // that predates them: no budget was chosen, no summary was ever computed.
    assert.equal(collaboration.budget, null);
    assert.equal(collaboration.summary, null);

    const turn = getConnection()
      .prepare(
        `SELECT content, consensus, contract, contract_error, input_tokens, output_tokens
         FROM collaboration_turns WHERE id = ?`,
      )
      .get('legacy-turn-1') as LegacyTurnRow;

    assert.equal(turn.content, 'A position.');
    assert.equal(turn.consensus, 1);
    assert.equal(turn.contract, null);
    assert.equal(turn.contract_error, null);
    // Nobody metered that turn, which must not become a turn that cost zero.
    assert.equal(turn.input_tokens, null);
    assert.equal(turn.output_tokens, null);
  });
});
