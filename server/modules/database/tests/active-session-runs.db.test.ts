import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  activeSessionRunsDb,
  closeConnection,
  initializeDatabase,
} from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'active-session-runs-'));

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

test('a marker survives the run that wrote it and is listed with its provider', async () => {
  await withIsolatedDatabase(() => {
    activeSessionRunsDb.markStarted({
      sessionId: 'session-a',
      provider: 'claude',
      startedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, 0)),
    });

    const markers = activeSessionRunsDb.listAll();
    assert.equal(markers.length, 1);
    assert.equal(markers[0]?.session_id, 'session-a');
    assert.equal(markers[0]?.provider, 'claude');
    assert.equal(markers[0]?.started_at, '2026-01-01T10:00:00.000Z');
  });
});

test('a run that ends removes only its own marker', async () => {
  await withIsolatedDatabase(() => {
    activeSessionRunsDb.markStarted({ sessionId: 'ends', provider: 'claude' });
    activeSessionRunsDb.markStarted({ sessionId: 'keeps-running', provider: 'codex' });

    activeSessionRunsDb.clear('ends');

    const markers = activeSessionRunsDb.listAll();
    assert.deepEqual(markers.map((marker) => marker.session_id), ['keeps-running']);
  });
});

test('a session can only hold one marker, and the newest run wins', async () => {
  await withIsolatedDatabase(() => {
    activeSessionRunsDb.markStarted({
      sessionId: 'session-a',
      provider: 'claude',
      startedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, 0)),
    });
    // The previous run's marker was never cleared (its process died); the next
    // run on the same session must not leave two rows behind.
    activeSessionRunsDb.markStarted({
      sessionId: 'session-a',
      provider: 'codex',
      startedAt: new Date(Date.UTC(2026, 0, 1, 11, 0, 0)),
    });

    const markers = activeSessionRunsDb.listAll();
    assert.equal(markers.length, 1);
    assert.equal(markers[0]?.provider, 'codex');
    assert.equal(markers[0]?.started_at, '2026-01-01T11:00:00.000Z');
  });
});

test('markers are listed oldest run first', async () => {
  await withIsolatedDatabase(() => {
    activeSessionRunsDb.markStarted({
      sessionId: 'later',
      provider: 'claude',
      startedAt: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
    });
    activeSessionRunsDb.markStarted({
      sessionId: 'earlier',
      provider: 'claude',
      startedAt: new Date(Date.UTC(2026, 0, 1, 9, 0, 0)),
    });

    assert.deepEqual(
      activeSessionRunsDb.listAll().map((marker) => marker.session_id),
      ['earlier', 'later'],
    );
  });
});

test('clearAll empties the table and a blank session id is ignored', async () => {
  await withIsolatedDatabase(() => {
    activeSessionRunsDb.markStarted({ sessionId: '', provider: 'claude' });
    assert.equal(activeSessionRunsDb.listAll().length, 0);

    activeSessionRunsDb.markStarted({ sessionId: 'a', provider: 'claude' });
    activeSessionRunsDb.markStarted({ sessionId: 'b', provider: 'claude' });
    activeSessionRunsDb.clear('');
    assert.equal(activeSessionRunsDb.listAll().length, 2);

    activeSessionRunsDb.clearAll();
    assert.equal(activeSessionRunsDb.listAll().length, 0);
  });
});
