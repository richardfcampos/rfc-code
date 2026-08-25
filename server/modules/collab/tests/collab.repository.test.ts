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

test('a budget survives the round trip, and its absence resolves to the run defaults', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(
      collaborationInput({ budget: { totalTokens: 50_000, maxTurns: 4, turnTimeoutMs: 60_000 } }),
    );
    assert.deepEqual(mapCollaborationRow(collabRepository.getById('collab-1')!).budget, {
      totalTokens: 50_000,
      maxTurns: 4,
      turnTimeoutMs: 60_000,
    });

    // No budget stores NULL rather than a serialized copy of the defaults, so
    // there is one representation of "whatever this run's shape implies".
    collabRepository.insert(collaborationInput({ id: 'collab-2' }));
    const row = collabRepository.getById('collab-2')!;
    assert.equal(row.budget, null);
    assert.deepEqual(mapCollaborationRow(row).budget, {
      totalTokens: 200_000,
      maxTurns: 7,
      turnTimeoutMs: 300_000,
    });
  });
});

test('a council summary is written by updateStatus and read back as an object', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());
    const summary = {
      contractsParsed: 2,
      contractsFailed: 0,
      agreements: [{ point: 'the lock is held too long', agreedBy: ['profile-a', 'profile-b'] }],
      disputes: [],
      risks: [{ risk: 'stranded jobs', severity: 'high' as const, raisedBy: ['profile-b'] }],
      confidence: {
        min: 40,
        median: 60,
        max: 80,
        byParticipant: [
          { profileId: 'profile-a', value: 40 },
          { profileId: 'profile-b', value: 80 },
        ],
      },
      budget: {
        totalTokens: 200_000,
        maxTurns: 7,
        tokensUsed: 12_000,
        turnsUsed: 5,
        stoppedBy: null,
      },
    };

    collabRepository.updateStatus('collab-1', { status: 'converged', summary });

    const stored = mapCollaborationRow(collabRepository.getById('collab-1')!);
    assert.deepEqual(stored.summary, summary);

    // A later patch that says nothing about the summary must not erase it.
    collabRepository.updateStatus('collab-1', { status: 'converged', verdict: 'Done.' });
    assert.deepEqual(mapCollaborationRow(collabRepository.getById('collab-1')!).summary, summary);
  });
});

test('a turn keeps its contract, its parse error and what it cost', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());
    const contract = {
      evidence: [{ observation: 'the index is missing', source: 'schema.ts:12' }],
      risks: [],
      tests: [],
      disagreements: [{ with: 'premise', point: 'this assumes one writer' }],
      confidence: { value: 70, rationale: 'read the schema' },
    };

    collabRepository.appendTurn(
      turnInput({ id: 'turn-1', contract, usage: { inputTokens: 900, outputTokens: 100 } }),
    );
    collabRepository.appendTurn(
      turnInput({ id: 'turn-2', turnIndex: 1, contractError: 'missing: confidence' }),
    );

    const [first, second] = collabRepository.listTurns('collab-1').map(mapTurnRow);
    assert.deepEqual(first.contract, contract);
    assert.equal(first.contractError, null);
    assert.deepEqual(first.usage, { inputTokens: 900, outputTokens: 100 });

    // A turn nobody could read is still a turn, with its raw content intact.
    assert.equal(second.contract, null);
    assert.equal(second.contractError, 'missing: confidence');
    assert.equal(second.content, 'position');
    assert.equal(second.usage, null);
  });
});

test('a contract column corrupted by hand degrades to absent instead of throwing', async () => {
  await withIsolatedDatabase(() => {
    collabRepository.insert(collaborationInput());
    collabRepository.appendTurn(turnInput({ id: 'turn-1' }));
    getConnection()
      .prepare('UPDATE collaboration_turns SET contract = ? WHERE id = ?')
      .run('{ not json', 'turn-1');
    getConnection()
      .prepare('UPDATE collaborations SET summary = ?, budget = ? WHERE id = ?')
      .run(']]', 'nonsense', 'collab-1');

    const turn = mapTurnRow(collabRepository.listTurns('collab-1')[0]);
    assert.equal(turn.contract, null);
    assert.equal(turn.content, 'position');

    const collaboration = mapCollaborationRow(collabRepository.getById('collab-1')!);
    assert.equal(collaboration.summary, null);
    assert.equal(collaboration.budget.maxTurns, 7, 'an unreadable budget falls back to the shape');
  });
});

test('a row written before the council contract reads back as the run it was', async () => {
  await withIsolatedDatabase(() => {
    // Exactly what an older build left behind: every council column NULL.
    getConnection()
      .prepare(
        `INSERT INTO collaborations
           (id, topic, mode, project_path, status, max_rounds, current_round, participants, verdict)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-1',
        'Should we keep SQLite?',
        'debate',
        '/workspace/demo',
        'exhausted',
        3,
        3,
        JSON.stringify(collaborationInput().participants),
        'We kept it.',
      );
    getConnection()
      .prepare(
        `INSERT INTO collaboration_turns
           (id, collaboration_id, round, turn_index, profile_id, role, content, consensus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-turn-1', 'legacy-1', 1, 0, 'profile-a', 'participant', 'A position.', 1);

    const collaboration = mapCollaborationRow(collabRepository.getById('legacy-1')!);
    assert.equal(collaboration.verdict, 'We kept it.');
    assert.equal(collaboration.participants.length, 2);
    assert.equal(collaboration.summary, null, 'none was computed, so none is invented');
    // The ceiling it reports is the one it actually ran under: two seats over
    // three rounds, plus the synthesis.
    assert.deepEqual(collaboration.budget, {
      totalTokens: 200_000,
      maxTurns: 7,
      turnTimeoutMs: 300_000,
    });

    const [turn] = collabRepository.listTurns('legacy-1').map(mapTurnRow);
    assert.equal(turn.content, 'A position.');
    assert.equal(turn.consensus, true);
    assert.equal(turn.contract, null);
    assert.equal(turn.contractError, null);
    assert.equal(turn.usage, null);

    // And it stays a normal row: listable, patchable, deletable.
    assert.equal(collabRepository.list('/workspace/demo').length, 1);
    assert.ok(collabRepository.updateStatus('legacy-1', { status: 'stopped' }));
    assert.equal(collabRepository.deleteById('legacy-1'), true);
    assert.equal(collabRepository.listTurns('legacy-1').length, 0);
  });
});
