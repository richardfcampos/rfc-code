/**
 * Persistence guarantees the collaboration engine leans on: a transcript that
 * keeps its order, a status patch that never wipes a sibling field, and a boot
 * sweep that only touches runs the dead process left behind.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collabRepository } from '@/modules/collab/collab.repository.js';
import { mapCollaborationRow, mapTurnRow } from '@/modules/collab/collab.types.js';
import type { AppendTurnInput, InsertCollaborationInput } from '@/modules/collab/collab.types.js';
import { closeConnection, getConnection, initializeDatabase } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'collab-db-'));

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

function collaborationInput(overrides: Partial<InsertCollaborationInput> = {}): InsertCollaborationInput {
  return {
    id: 'collab-1',
    topic: 'Should we split the scheduler?',
    mode: 'debate',
    projectPath: '/workspace/demo',
    maxRounds: 3,
    participants: [
      { profileId: 'profile-a', provider: 'claude', role: 'participant' },
      { profileId: 'profile-b', provider: 'claude', role: 'participant' },
    ],
    ...overrides,
  };
}

function turnInput(overrides: Partial<AppendTurnInput> & { id: string }): AppendTurnInput {
  return {
    collaborationId: 'collab-1',
    round: 1,
    turnIndex: 0,
    profileId: 'profile-a',
    role: 'participant',
    content: 'position',
    ...overrides,
  };
}

test('insert stores a running collaboration and reads it back with its participants', async () => {
  await withIsolatedDatabase(() => {
    const inserted = collabRepository.insert(collaborationInput());

    assert.equal(inserted.status, 'running');
    assert.equal(inserted.current_round, 0);
    assert.equal(inserted.verdict, null);

    const summary = mapCollaborationRow(collabRepository.getById('collab-1')!);
    assert.equal(summary.topic, 'Should we split the scheduler?');
    assert.equal(summary.mode, 'debate');
    assert.equal(summary.projectPath, '/workspace/demo');
    assert.equal(summary.maxRounds, 3);
    assert.deepEqual(summary.participants, collaborationInput().participants);
    assert.match(summary.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

test('a corrupted participants blob degrades to an empty list instead of throwing', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());
    getConnection()
      .prepare('UPDATE collaborations SET participants = ? WHERE id = ?')
      .run('{not json', 'collab-1');

    const row = collabRepository.getById('collab-1');
    assert.deepEqual(mapCollaborationRow(row!).participants, []);
  });
});

test('list filters by project path and returns newest runs first', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput({ id: 'collab-1' }));
    collabRepository.insert(collaborationInput({ id: 'collab-2' }));
    collabRepository.insert(collaborationInput({ id: 'collab-3', projectPath: '/workspace/other' }));

    assert.deepEqual(
      collabRepository.list('/workspace/demo').map((row) => row.id),
      ['collab-2', 'collab-1'],
    );
    assert.equal(collabRepository.list().length, 3);
  });
});

test('turns come back in round then index order regardless of insertion order', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());
    collabRepository.appendTurn(turnInput({ id: 'turn-r2-i0', round: 2 }));
    collabRepository.appendTurn(turnInput({ id: 'turn-r1-i1', turnIndex: 1, consensus: false }));
    collabRepository.appendTurn(turnInput({ id: 'turn-r1-i0', consensus: true }));

    const turns = collabRepository.listTurns('collab-1').map(mapTurnRow);
    assert.deepEqual(turns.map((turn) => turn.id), ['turn-r1-i0', 'turn-r1-i1', 'turn-r2-i0']);
    assert.deepEqual(turns.map((turn) => turn.consensus), [true, false, null]);
    assert.deepEqual(collabRepository.listTurns('missing-collab'), []);
  });
});

test('appendTurn records the error of a failed turn without losing its content', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());
    const stored = collabRepository.appendTurn(
      turnInput({ id: 'turn-1', role: 'arbiter', content: '', error: 'provider timed out' }),
    );

    assert.ok(stored);
    assert.equal(stored.error, 'provider timed out');
    assert.equal(stored.consensus, null);
    assert.equal(mapTurnRow(stored).role, 'arbiter');
  });
});

test('appendTurn drops a turn whose collaboration was deleted mid-run', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());
    assert.ok(collabRepository.appendTurn(turnInput({ id: 'turn-1' })));

    collabRepository.deleteById('collab-1');

    // The in-flight turn lands after the delete: it must not survive as a row
    // no listing reaches and no cascade will ever remove.
    assert.equal(collabRepository.appendTurn(turnInput({ id: 'turn-2' })), null);
    assert.deepEqual(collabRepository.listTurns('collab-1'), []);

    const { total } = getConnection()
      .prepare('SELECT COUNT(*) AS total FROM collaboration_turns')
      .get() as { total: number };
    assert.equal(total, 0, 'no orphan row may be left behind');
  });
});

test('updateStatus writes only the fields it was given', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());

    const converged = collabRepository.updateStatus('collab-1', {
      status: 'converged',
      verdict: 'ship it',
      currentRound: 2,
    });
    assert.equal(converged?.status, 'converged');
    assert.equal(converged?.verdict, 'ship it');
    assert.equal(converged?.current_round, 2);

    // A later failure must not erase the verdict or rewind the round counter.
    const failed = collabRepository.updateStatus('collab-1', { status: 'failed', error: 'boom' });
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.error, 'boom');
    assert.equal(failed?.verdict, 'ship it');
    assert.equal(failed?.current_round, 2);

    assert.equal(collabRepository.updateStatus('missing-collab', { status: 'stopped' }), null);
  });
});

test('onlyIfStatus refuses a write once the run left the expected status', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());

    const claimed = collabRepository.updateStatus(
      'collab-1',
      { status: 'running', currentRound: 1 },
      { onlyIfStatus: 'running' },
    );
    assert.equal(claimed?.current_round, 1);

    // The stop route moves the row while the engine is still mid-run.
    collabRepository.updateStatus('collab-1', { status: 'stopped' });

    const late = collabRepository.updateStatus(
      'collab-1',
      { status: 'converged', verdict: 'ship it', currentRound: 2 },
      { onlyIfStatus: 'running' },
    );
    assert.equal(late, null, 'the guarded write must report that it did not apply');

    const row = collabRepository.getById('collab-1');
    assert.equal(row?.status, 'stopped');
    assert.equal(row?.verdict, null);
    assert.equal(row?.current_round, 1);
  });
});

test('deleting a collaboration removes its transcript', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());
    collabRepository.insert(collaborationInput({ id: 'collab-2' }));
    collabRepository.appendTurn(turnInput({ id: 'turn-1' }));
    collabRepository.appendTurn(turnInput({ id: 'turn-2', collaborationId: 'collab-2' }));

    assert.equal(collabRepository.deleteById('collab-1'), true);
    assert.equal(collabRepository.getById('collab-1'), null);
    assert.deepEqual(collabRepository.listTurns('collab-1'), []);
    assert.equal(collabRepository.listTurns('collab-2').length, 1);
    assert.equal(collabRepository.deleteById('collab-1'), false);
  });
});

test('failOrphanedRuns closes running rows and leaves finished ones untouched', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput({ id: 'collab-running' }));
    collabRepository.insert(collaborationInput({ id: 'collab-done', status: 'converged' }));
    collabRepository.updateStatus('collab-done', { status: 'converged', verdict: 'agreed' });

    assert.equal(collabRepository.failOrphanedRuns(), 1);

    const orphan = collabRepository.getById('collab-running');
    assert.equal(orphan?.status, 'failed');
    assert.ok(orphan?.error && orphan.error.length > 0);

    const finished = collabRepository.getById('collab-done');
    assert.equal(finished?.status, 'converged');
    assert.equal(finished?.verdict, 'agreed');

    // Idempotent: a second boot finds nothing left in `running`.
    assert.equal(collabRepository.failOrphanedRuns(), 0);
  });
});
