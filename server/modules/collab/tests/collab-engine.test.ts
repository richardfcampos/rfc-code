/**
 * Behaviour of the collaboration round loop, asserted through what it leaves in
 * the database — the only thing a poller, and therefore the UI, can see.
 *
 * The runtime is always a fake owned by the test: no provider, no network, no
 * spend. Every scenario runs against a throwaway SQLite file so ordering,
 * status transitions and partial progress are checked for real instead of
 * against a mocked repository that would agree with any implementation.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';

import { createCollabEngine } from '../collab-engine.service.js';
import { collabRepository } from '../collab.repository.js';
import { mapTurnRow } from '../collab.types.js';
import type { CollabRuntime } from '../collab-engine.service.js';
import type { CollabParticipant, InsertCollaborationInput } from '../collab.types.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'collab-engine-'));

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

const DEBATERS: CollabParticipant[] = [
  { profileId: 'profile-a', provider: 'claude', role: 'participant' },
  { profileId: 'profile-b', provider: 'claude', role: 'participant' },
];

const REVIEW_PAIR: CollabParticipant[] = [
  { profileId: 'profile-a', provider: 'claude', role: 'author' },
  { profileId: 'profile-b', provider: 'claude', role: 'reviewer' },
];

function seed(overrides: Partial<InsertCollaborationInput> = {}): string {
  const id = overrides.id ?? randomUUID();
  collabRepository.insert({
    topic: 'Should we keep SQLite?',
    mode: 'debate',
    projectPath: '/workspace/demo',
    maxRounds: 3,
    participants: DEBATERS,
    ...overrides,
    id,
  });
  return id;
}

interface RuntimeCall {
  prompt: string;
  profileId: string;
  cwd: string;
}

/** Answers are consumed in call order; anything unscripted keeps a debate open. */
function scriptedRuntime(answers: (string | Error)[]): {
  runtime: CollabRuntime;
  calls: RuntimeCall[];
} {
  const calls: RuntimeCall[] = [];
  const runtime: CollabRuntime = (input) => {
    calls.push({ prompt: input.prompt, profileId: input.profileId, cwd: input.cwd });
    const answer = answers[calls.length - 1] ?? 'Still thinking.\nCONSENSUS: NO — unscripted turn';
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { runtime, calls };
}

function readTurns(id: string) {
  return collabRepository.listTurns(id).map(mapTurnRow);
}

function readCollaboration(id: string) {
  const row = collabRepository.getById(id);
  assert.ok(row, 'expected the collaboration row to exist');
  return row;
}

test('a debate that never agrees runs every round and closes exhausted with a verdict', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 2 });
    const { runtime, calls } = scriptedRuntime([
      'A opens.\nCONSENSUS: NO — too early',
      'B answers.\nCONSENSUS: NO — disagree',
      'A again.\nCONSENSUS: NO — still no',
      'B again.\nCONSENSUS: NO — still no',
      'Synthesis of the debate.',
    ]);

    await createCollabEngine({ runtime }).run(id);

    const turns = readTurns(id);
    assert.equal(calls.length, 5);
    assert.deepEqual(
      turns.map((turn) => [turn.round, turn.turnIndex, turn.role, turn.profileId]),
      [
        [1, 0, 'participant', 'profile-a'],
        [1, 1, 'participant', 'profile-b'],
        [2, 0, 'participant', 'profile-a'],
        [2, 1, 'participant', 'profile-b'],
        [2, 2, 'arbiter', 'profile-a'],
      ],
    );
    assert.deepEqual(
      turns.slice(0, 4).map((turn) => turn.consensus),
      [false, false, false, false],
    );

    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'exhausted');
    assert.equal(collaboration.verdict, 'Synthesis of the debate.');
    assert.equal(collaboration.current_round, 2);
    assert.equal(turns[4].content, 'Synthesis of the debate.');
  });
});

test('an opening turn cannot converge a debate nobody has disagreed in yet', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 3 });
    const { runtime, calls } = scriptedRuntime([
      // The opener is asked to agree with a position that does not exist yet.
      'A agrees.\nCONSENSUS: YES',
      'B agrees.\nCONSENSUS: YES',
      'A still agrees.\nCONSENSUS: YES',
      'B still agrees.\nCONSENSUS: YES',
      'We agreed on keeping SQLite.',
    ]);

    await createCollabEngine({ runtime }).run(id);

    const turns = readTurns(id);
    assert.equal(calls.length, 5, 'a second round must happen before a verdict');
    assert.deepEqual(
      turns.map((turn) => [turn.round, turn.role]),
      [
        [1, 'participant'],
        [1, 'participant'],
        [2, 'participant'],
        [2, 'participant'],
        [2, 'arbiter'],
      ],
    );
    // The vacuous signal is still stored as the model wrote it, for display.
    assert.deepEqual(turns.slice(0, 4).map((turn) => turn.consensus), [true, true, true, true]);

    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'converged');
    assert.equal(collaboration.current_round, 2);
    assert.equal(collaboration.verdict, 'We agreed on keeping SQLite.');
  });
});

test('vote runs exactly one round whatever the stored ceiling says, and stays blind', async () => {
  await withIsolatedDatabase(async () => {
    const participants: CollabParticipant[] = [
      ...DEBATERS,
      { profileId: 'profile-c', provider: 'claude', role: 'participant' },
    ];
    const id = seed({ mode: 'vote', maxRounds: 3, participants });
    const { runtime, calls } = scriptedRuntime([
      'Answer from A.\nCONSENSUS: YES',
      'Answer from B.',
      'Answer from C.',
      'Comparison of the three answers.',
    ]);

    await createCollabEngine({ runtime }).run(id);

    const turns = readTurns(id);
    assert.equal(calls.length, 4);
    assert.deepEqual(turns.map((turn) => turn.round), [1, 1, 1, 1]);
    assert.deepEqual(turns.map((turn) => turn.role), [
      'participant',
      'participant',
      'participant',
      'arbiter',
    ]);
    // A blind answer never carries a consensus signal, even if the model emits one.
    assert.deepEqual(turns.slice(0, 3).map((turn) => turn.consensus), [null, null, null]);
    assert.ok(!calls[1].prompt.includes('Answer from A.'));
    assert.ok(calls[3].prompt.includes('Answer from A.'));
    assert.equal(readCollaboration(id).status, 'exhausted');
  });
});

test('an injected name resolver reaches the prompts, the transcript and the verdict', async () => {
  await withIsolatedDatabase(async () => {
    const names: Record<string, string> = { 'profile-a': 'Work account', 'profile-b': 'Personal' };
    const id = seed({ maxRounds: 1 });
    const { runtime, calls } = scriptedRuntime([
      'A opens.\nCONSENSUS: NO — too early',
      'B answers.\nCONSENSUS: NO — disagree',
      'Synthesis.',
    ]);

    await createCollabEngine({ runtime, resolveName: (id_) => names[id_] ?? id_ }).run(id);

    assert.ok(calls[0].prompt.includes('You are Work account'));
    assert.ok(calls[0].prompt.includes('Other participants: Personal (participant)'));
    // The transcript the second participant and the arbiter read is named too.
    assert.ok(calls[1].prompt.includes('Round 1 — Work account (participant)'));
    assert.ok(calls[2].prompt.includes('Round 1 — Personal (participant)'));
    assert.ok(!calls[2].prompt.includes('profile-a'));
  });
});

test('without a resolver the prompts fall back to the profile id', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 1 });
    const { runtime, calls } = scriptedRuntime(['A opens.\nCONSENSUS: NO — too early']);

    await createCollabEngine({ runtime }).run(id);

    assert.ok(calls[0].prompt.includes('You are profile-a'));
    assert.ok(calls[0].prompt.includes('Other participants: profile-b (participant)'));
  });
});

test('each turn is persisted before the next one starts', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 1 });
    let seenBeforeSecondTurn: ReturnType<typeof readTurns> = [];

    const runtime: CollabRuntime = (input) => {
      if (input.profileId === 'profile-b') seenBeforeSecondTurn = readTurns(id);
      return Promise.resolve('Position.\nCONSENSUS: NO — not yet');
    };

    await createCollabEngine({ runtime }).run(id);

    assert.equal(seenBeforeSecondTurn.length, 1);
    assert.equal(seenBeforeSecondTurn[0].profileId, 'profile-a');
    assert.equal(seenBeforeSecondTurn[0].content, 'Position.\nCONSENSUS: NO — not yet');
  });
});

test('review keeps running while the reviewer disagrees, and the author cannot end it alone', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ mode: 'review', maxRounds: 2, participants: REVIEW_PAIR });
    const { runtime } = scriptedRuntime([
      'Draft.\nCONSENSUS: YES',
      'Objections.\nCONSENSUS: NO — the migration is missing',
      'Revised draft.\nCONSENSUS: YES',
      'Still not convinced.\nCONSENSUS: NO — same objection',
      'Synthesis.',
    ]);

    await createCollabEngine({ runtime }).run(id);

    const turns = readTurns(id);
    assert.equal(turns.filter((turn) => turn.role === 'participant').length, 4);
    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'exhausted');
    assert.equal(collaboration.current_round, 2);
  });
});

test('review converges as soon as the reviewer agrees', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ mode: 'review', maxRounds: 3, participants: REVIEW_PAIR });
    const { runtime, calls } = scriptedRuntime([
      'Draft.\nCONSENSUS: YES',
      'Objections.\nCONSENSUS: NO — the migration is missing',
      'Revised draft with the migration.\nCONSENSUS: YES',
      'Looks right now.\nCONSENSUS: YES',
      'Synthesis.',
    ]);

    await createCollabEngine({ runtime }).run(id);

    assert.equal(calls.length, 5);
    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'converged');
    assert.equal(collaboration.current_round, 2);
  });
});

test('a stop between turns abandons the run without writing a verdict', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 3 });
    const calls: string[] = [];

    const runtime: CollabRuntime = (input) => {
      calls.push(input.profileId);
      // Stands in for the stop route landing while the first turn is in flight.
      collabRepository.updateStatus(id, { status: 'stopped' });
      return Promise.resolve('Opening position.\nCONSENSUS: NO — early days');
    };

    await createCollabEngine({ runtime }).run(id);

    assert.deepEqual(calls, ['profile-a']);
    const turns = readTurns(id);
    assert.equal(turns.length, 1, 'a turn already paid for is still recorded');
    assert.equal(turns[0].profileId, 'profile-a');

    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'stopped');
    assert.equal(collaboration.verdict, null);
  });
});

test('a stop landing during the synthesis is not overwritten by the verdict', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 1 });
    let call = 0;

    const runtime: CollabRuntime = () => {
      call += 1;
      // The stop route lands while the arbiter turn is still in flight.
      if (call === 3) collabRepository.updateStatus(id, { status: 'stopped' });
      return Promise.resolve(call === 3 ? 'Synthesis.' : 'Position.\nCONSENSUS: NO — not yet');
    };

    await createCollabEngine({ runtime }).run(id);

    const turns = readTurns(id);
    assert.equal(turns.length, 3, 'the arbiter turn was paid for, so it is recorded');
    assert.equal(turns[2].role, 'arbiter');
    assert.equal(turns[2].content, 'Synthesis.');

    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'stopped', 'the user decision outranks the outcome');
    assert.equal(collaboration.verdict, null);
  });
});

test('a stop landing during a turn that then fails keeps the run stopped', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 2 });
    const calls: string[] = [];

    const runtime: CollabRuntime = (input) => {
      calls.push(input.profileId);
      collabRepository.updateStatus(id, { status: 'stopped' });
      return Promise.reject(new Error('Profile profile-a is not authenticated.'));
    };

    await createCollabEngine({ runtime }).run(id);

    assert.deepEqual(calls, ['profile-a']);
    const turns = readTurns(id);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].error, 'Profile profile-a is not authenticated.');

    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'stopped', 'a failure may not reopen a stopped run');
    assert.equal(collaboration.error, null);
  });
});

test('a run whose every turn failed ends failed without paying for an arbiter', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 1 });
    const calls: string[] = [];

    // Both accounts hang until the deadline, so no turn produces any content.
    const runtime: CollabRuntime = (input) => {
      calls.push(input.profileId);
      return new Promise<string>((resolve) => {
        input.signal?.addEventListener('abort', () => resolve('too late'));
      });
    };

    await createCollabEngine({ runtime, turnTimeoutMs: 25 }).run(id);

    const turns = readTurns(id);
    assert.deepEqual(calls, ['profile-a', 'profile-b'], 'no synthesis may be requested');
    assert.equal(turns.length, 2);
    assert.equal(turns.some((turn) => turn.role === 'arbiter'), false);

    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'failed');
    assert.match(collaboration.error ?? '', /abandoned after/i);
    assert.equal(collaboration.verdict, null);
  });
});

test('a turn that runs out of time is recorded as an error and the collaboration continues', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 1 });
    let aborted = false;

    const runtime: CollabRuntime = (input) => {
      if (input.profileId === 'profile-a') {
        return new Promise<string>((resolve) => {
          input.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve('too late');
          });
        });
      }
      return Promise.resolve('B answers.\nCONSENSUS: NO — A said nothing');
    };

    await createCollabEngine({ runtime, turnTimeoutMs: 25 }).run(id);

    const turns = readTurns(id);
    assert.equal(aborted, true, 'the abandoned turn must be signalled to stop');
    assert.equal(turns.length, 3);
    assert.equal(turns[0].content, '');
    assert.match(turns[0].error ?? '', /abandoned after/i);
    assert.equal(turns[0].consensus, null);
    assert.equal(turns[1].content, 'B answers.\nCONSENSUS: NO — A said nothing');
    assert.equal(turns[2].role, 'arbiter');
    assert.equal(readCollaboration(id).status, 'exhausted');
  });
});

test('a rejecting runtime fails the whole run and keeps the turns already recorded', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 3 });
    const { runtime, calls } = scriptedRuntime([
      'A opens.\nCONSENSUS: NO — too early',
      new Error('Profile profile-b is not authenticated.'),
    ]);

    await createCollabEngine({ runtime }).run(id);

    const turns = readTurns(id);
    assert.equal(calls.length, 2, 'the run stops at the failing turn');
    assert.equal(turns.length, 2);
    assert.equal(turns[1].content, '');
    assert.equal(turns[1].error, 'Profile profile-b is not authenticated.');

    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'failed');
    assert.equal(collaboration.error, 'Profile profile-b is not authenticated.');
    assert.equal(collaboration.verdict, null);
  });
});

test('current_round advances so the UI can show progress while the run is live', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 2 });
    const observed: number[] = [];

    const runtime: CollabRuntime = () => {
      observed.push(readCollaboration(id).current_round);
      return Promise.resolve('Position.\nCONSENSUS: NO — not yet');
    };

    await createCollabEngine({ runtime }).run(id);

    assert.deepEqual(observed, [1, 1, 2, 2, 2]);
    assert.equal(readCollaboration(id).current_round, 2);
  });
});

test('an unexpected persistence failure lands as a failed status instead of a rejection', async () => {
  await withIsolatedDatabase(async () => {
    const id = seed({ maxRounds: 1 });
    const repository: typeof collabRepository = {
      ...collabRepository,
      appendTurn: () => {
        throw new Error('disk is full');
      },
    };
    const { runtime } = scriptedRuntime(['A opens.\nCONSENSUS: NO — too early']);

    await createCollabEngine({ runtime, repository }).run(id);

    const collaboration = readCollaboration(id);
    assert.equal(collaboration.status, 'failed');
    assert.equal(collaboration.error, 'disk is full');
  });
});

test('a collaboration that is missing, already finished or empty is left alone', async () => {
  await withIsolatedDatabase(async () => {
    const { runtime, calls } = scriptedRuntime([]);
    const engine = createCollabEngine({ runtime });

    await engine.run('does-not-exist');

    const stopped = seed({ status: 'stopped' });
    await engine.run(stopped);
    assert.equal(readCollaboration(stopped).status, 'stopped');

    const empty = seed({ participants: [] });
    await engine.run(empty);
    const emptyRow = readCollaboration(empty);
    assert.equal(emptyRow.status, 'failed');
    assert.match(emptyRow.error ?? '', /no participants/i);

    assert.equal(calls.length, 0, 'no model call may happen in any of these cases');
  });
});
