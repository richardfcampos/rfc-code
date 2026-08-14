import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionLegsDb } from '@/modules/database/repositories/session-legs.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-mapping-'));
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

test('disk-discovered sessions are keyed by the provider id for both columns', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('provider-abc', 'claude', '/workspace/demo', 'From Disk');

    const row = sessionsDb.getSessionById('provider-abc');
    assert.equal(row?.session_id, 'provider-abc');
    assert.equal(row?.provider_session_id, 'provider-abc');

    const byProviderId = sessionsDb.getSessionByProviderSessionId('provider-abc');
    assert.equal(byProviderId?.session_id, 'provider-abc');
  });
});

test('app sessions get the provider id assigned without creating a duplicate row', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-id-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-id-1', 'provider-xyz');

    // A later synchronizer pass that discovers the transcript on disk must
    // update the app row in place instead of inserting a provider-keyed row.
    const returnedId = sessionsDb.createSession(
      'provider-xyz',
      'claude',
      '/workspace/demo',
      'Synced Name',
      undefined,
      undefined,
      '/fake/path/provider-xyz.jsonl',
    );

    assert.equal(returnedId, 'app-id-1');
    assert.equal(sessionsDb.getAllSessions().length, 1);

    const row = sessionsDb.getSessionById('app-id-1');
    assert.equal(row?.provider_session_id, 'provider-xyz');
    assert.equal(row?.jsonl_path, '/fake/path/provider-xyz.jsonl');
  });
});

test('assignProviderSessionId merges a watcher-created duplicate into the app row', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-id-2', 'codex', '/workspace/demo');

    // Simulate the race: the filesystem watcher indexed the provider
    // transcript before the runtime announced its session id to the gateway.
    sessionsDb.createSession(
      'provider-race',
      'codex',
      '/workspace/demo',
      'Watcher Name',
      undefined,
      undefined,
      '/fake/provider-race.jsonl',
    );
    assert.equal(sessionsDb.getAllSessions().length, 2);

    sessionsDb.assignProviderSessionId('app-id-2', 'provider-race');

    const rows = sessionsDb.getAllSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.session_id, 'app-id-2');
    assert.equal(rows[0]?.provider_session_id, 'provider-race');
    // Transcript path and name from the duplicate are adopted.
    assert.equal(rows[0]?.jsonl_path, '/fake/provider-race.jsonl');
    assert.equal(rows[0]?.custom_name, 'Watcher Name');
  });
});

test('legacy provider-keyed rows stay resolvable through both lookups', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('legacy-1', 'opencode', '/workspace/demo');

    assert.equal(sessionsDb.getSessionById('legacy-1')?.provider, 'opencode');
    assert.equal(sessionsDb.getSessionByProviderSessionId('legacy-1')?.session_id, 'legacy-1');
  });
});

test('getSessionByProviderSessionId resolves a previous, now-inactive leg back to its owning session', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-multi-leg', 'claude', '/workspace/demo');

    const firstLeg = sessionLegsDb.openLeg({
      sessionId: 'session-multi-leg',
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });
    sessionLegsDb.attachProviderSessionId(firstLeg.leg_id, 'native-old', '/fake/native-old.jsonl');

    // Switching provider closes the first leg and opens a second one, so
    // `sessions.provider_session_id` now points at the new leg, not the old one.
    sessionLegsDb.openLeg({
      sessionId: 'session-multi-leg',
      provider: 'codex',
      profileId: null,
      profileNameAtSwitch: null,
    });
    sessionsDb.assignProviderSessionId('session-multi-leg', 'native-new');

    const resolved = sessionsDb.getSessionByProviderSessionId('native-old');
    assert.equal(resolved?.session_id, 'session-multi-leg');
  });
});

test('getSessionByProviderSessionId returns null for an id unknown to both sessions and session_legs', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-no-match', 'claude', '/workspace/demo');

    assert.equal(sessionsDb.getSessionByProviderSessionId('never-seen-id'), null);
  });
});

test('assignProviderSessionId writes the provider id and jsonl_path onto the active leg', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-active-leg', 'claude', '/workspace/demo');
    sessionsDb.updateSessionJsonlPath('session-active-leg', '/fake/session-active-leg.jsonl');

    const leg = sessionLegsDb.openLeg({
      sessionId: 'session-active-leg',
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });

    sessionsDb.assignProviderSessionId('session-active-leg', 'native-active');

    const sessionRow = sessionsDb.getSessionById('session-active-leg');
    assert.equal(sessionRow?.provider_session_id, 'native-active');

    const legs = sessionLegsDb.listLegs('session-active-leg');
    const activeLeg = legs.find((l) => l.leg_id === leg.leg_id);
    assert.equal(activeLeg?.provider_session_id, 'native-active');
    assert.equal(activeLeg?.jsonl_path, '/fake/session-active-leg.jsonl');
  });
});

test('assignProviderSessionId does not throw when the session has no active leg', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-no-active-leg', 'claude', '/workspace/demo');

    assert.doesNotThrow(() => {
      sessionsDb.assignProviderSessionId('session-no-active-leg', 'native-orphan');
    });

    const sessionRow = sessionsDb.getSessionById('session-no-active-leg');
    assert.equal(sessionRow?.provider_session_id, 'native-orphan');
  });
});
