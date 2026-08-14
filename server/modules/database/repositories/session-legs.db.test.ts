import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionLegsDb } from '@/modules/database/repositories/session-legs.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-legs-db-'));
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

test('openLeg on a fresh session creates the first leg at seq 0 with no prior active leg to close', async () => {
  await withIsolatedDatabase(() => {
    const leg = sessionLegsDb.openLeg({
      sessionId: 'session-1',
      provider: 'claude',
      profileId: 'profile-1',
      profileNameAtSwitch: 'Alice',
    });

    assert.equal(leg.session_id, 'session-1');
    assert.equal(leg.seq, 0);
    assert.equal(leg.provider, 'claude');
    assert.equal(leg.profile_id, 'profile-1');
    assert.equal(leg.profile_name_at_switch, 'Alice');
    assert.equal(leg.provider_session_id, null);
    assert.equal(leg.jsonl_path, null);
    assert.equal(leg.ended_at, null);
    assert.ok(leg.leg_id);
  });
});

test('openLeg closes the previously-active leg and assigns the next seq', async () => {
  await withIsolatedDatabase(() => {
    const first = sessionLegsDb.openLeg({
      sessionId: 'session-2',
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });

    const second = sessionLegsDb.openLeg({
      sessionId: 'session-2',
      provider: 'codex',
      profileId: 'profile-2',
      profileNameAtSwitch: 'Bob',
    });

    assert.equal(second.seq, 1);
    assert.notEqual(second.leg_id, first.leg_id);

    const legs = sessionLegsDb.listLegs('session-2');
    assert.equal(legs.length, 2);
    assert.ok(legs[0].ended_at, 'first leg should have been closed');
    assert.equal(legs[1].ended_at, null);
  });
});

test('findLeg matches a NULL profile_id leg using IS, not =', async () => {
  await withIsolatedDatabase(() => {
    sessionLegsDb.openLeg({
      sessionId: 'session-3',
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });

    const found = sessionLegsDb.findLeg('session-3', 'claude', null);
    assert.ok(found);
    assert.equal(found?.profile_id, null);

    const notFound = sessionLegsDb.findLeg('session-3', 'claude', 'some-other-profile');
    assert.equal(notFound, null);
  });
});

test('activateLeg reactivates an existing leg without touching started_at and closes whatever was active', async () => {
  await withIsolatedDatabase(() => {
    const first = sessionLegsDb.openLeg({
      sessionId: 'session-4',
      provider: 'claude',
      profileId: 'profile-a',
      profileNameAtSwitch: 'Alice',
    });
    const second = sessionLegsDb.openLeg({
      sessionId: 'session-4',
      provider: 'codex',
      profileId: 'profile-b',
      profileNameAtSwitch: 'Bob',
    });

    const startedAtBeforeReactivation = first.started_at;

    sessionLegsDb.activateLeg('session-4', first.leg_id);

    const legs = sessionLegsDb.listLegs('session-4');
    const reactivatedFirst = legs.find((leg) => leg.leg_id === first.leg_id);
    const closedSecond = legs.find((leg) => leg.leg_id === second.leg_id);

    assert.equal(reactivatedFirst?.ended_at, null);
    assert.equal(reactivatedFirst?.started_at, startedAtBeforeReactivation);
    assert.ok(closedSecond?.ended_at, 'second leg should now be closed');
  });
});

test('attachProviderSessionId sets both provider_session_id and jsonl_path', async () => {
  await withIsolatedDatabase(() => {
    const leg = sessionLegsDb.openLeg({
      sessionId: 'session-5',
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });

    sessionLegsDb.attachProviderSessionId(leg.leg_id, 'native-abc', '/jsonl/native-abc.jsonl');

    const legs = sessionLegsDb.listLegs('session-5');
    assert.equal(legs[0].provider_session_id, 'native-abc');
    assert.equal(legs[0].jsonl_path, '/jsonl/native-abc.jsonl');
  });
});

test('findSessionIdByProviderSessionId resolves the owning session, and returns null for unknown ids', async () => {
  await withIsolatedDatabase(() => {
    const leg = sessionLegsDb.openLeg({
      sessionId: 'session-6',
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });
    sessionLegsDb.attachProviderSessionId(leg.leg_id, 'native-xyz', null);

    assert.equal(sessionLegsDb.findSessionIdByProviderSessionId('native-xyz'), 'session-6');
    assert.equal(sessionLegsDb.findSessionIdByProviderSessionId('unknown-id'), null);
  });
});

test('listLegs returns legs ordered by seq ascending', async () => {
  await withIsolatedDatabase(() => {
    sessionLegsDb.openLeg({
      sessionId: 'session-7',
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });
    sessionLegsDb.openLeg({
      sessionId: 'session-7',
      provider: 'codex',
      profileId: null,
      profileNameAtSwitch: null,
    });
    sessionLegsDb.openLeg({
      sessionId: 'session-7',
      provider: 'gemini',
      profileId: null,
      profileNameAtSwitch: null,
    });

    const legs = sessionLegsDb.listLegs('session-7');
    assert.deepEqual(
      legs.map((leg) => leg.seq),
      [0, 1, 2]
    );
    assert.deepEqual(
      legs.map((leg) => leg.provider),
      ['claude', 'codex', 'gemini']
    );
  });
});

test('database has no leftover row when querying an unknown session', async () => {
  await withIsolatedDatabase(() => {
    assert.deepEqual(sessionLegsDb.listLegs('never-existed'), []);
    assert.equal(sessionLegsDb.findLeg('never-existed', 'claude', null), null);

    // Sanity check the schema for future maintainers of this test file:
    // session_legs must exist before any of the above calls could work.
    const db = getConnection();
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_legs'`)
      .get();
    assert.ok(tableExists);
  });
});
