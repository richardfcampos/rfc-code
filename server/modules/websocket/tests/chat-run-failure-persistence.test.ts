import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  sessionRunFailuresDb,
  sessionsDb,
} from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/** Collects outbound frames; `readyState` is flipped to fake a closed tab. */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-run-failure-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function startRun(appSessionId: string, connection: FakeConnection) {
  sessionsDb.createAppSession(appSessionId, 'claude', '/workspace/demo');
  const run = chatRunRegistry.startRun({
    appSessionId,
    provider: 'claude',
    providerSessionId: null,
    connection,
    userId: 'user-1',
  });
  assert.ok(run);
  return run;
}

test('a failed run persists the reason it died', async () => {
  await withIsolatedDatabase(() => {
    const connection = new FakeConnection();
    const run = startRun('failed-run', connection);

    run.writer.send({
      kind: 'error',
      provider: 'claude',
      sessionId: 'native-1',
      content: "You've hit your session limit",
    });
    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-1', exitCode: 1 });

    const failures = sessionRunFailuresDb.listBySession('failed-run');
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.error_message, "You've hit your session limit");
    assert.equal(failures[0]?.exit_code, 1);
    assert.equal(failures[0]?.provider, 'claude');
  });
});

test('the reason survives a run that failed while nobody was connected', async () => {
  await withIsolatedDatabase(() => {
    const connection = new FakeConnection();
    const run = startRun('offline-run', connection);

    // The tab went away mid-run: nothing more can be delivered live.
    connection.readyState = 3; // WS_CLOSED_STATE

    run.writer.send({
      kind: 'error',
      provider: 'claude',
      sessionId: 'native-2',
      content: 'Not logged in · Please run /login',
    });
    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-2', exitCode: 1 });

    // Nothing reached the client...
    assert.equal(connection.frames.length, 0);
    // ...but the failure is still on record.
    const failures = sessionRunFailuresDb.listBySession('offline-run');
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.error_message, 'Not logged in · Please run /login');
  });
});

test('a run killed without any error message still records a stop reason', async () => {
  await withIsolatedDatabase(() => {
    const connection = new FakeConnection();
    const run = startRun('killed-run', connection);

    // An OOM-killed runtime never gets to report anything.
    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-3', exitCode: null });

    const failures = sessionRunFailuresDb.listBySession('killed-run');
    assert.equal(failures.length, 1);
    assert.match(failures[0]?.error_message ?? '', /without reporting a reason/);
  });
});

test('successful and aborted runs record nothing', async () => {
  await withIsolatedDatabase(() => {
    const okConnection = new FakeConnection();
    const okRun = startRun('ok-run', okConnection);
    okRun.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-4', exitCode: 0 });

    const abortedConnection = new FakeConnection();
    const abortedRun = startRun('aborted-run', abortedConnection);
    // Mid-run stderr that the user then interrupted — not a failure to explain.
    abortedRun.writer.send({
      kind: 'error',
      provider: 'claude',
      sessionId: 'native-5',
      content: 'some stderr noise',
    });
    abortedRun.writer.send({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'native-5',
      exitCode: 1,
      aborted: true,
    });

    assert.equal(sessionRunFailuresDb.listBySession('ok-run').length, 0);
    assert.equal(sessionRunFailuresDb.listBySession('aborted-run').length, 0);
  });
});

test('a later clean run clears the failures recorded before it', async () => {
  await withIsolatedDatabase(() => {
    const failedConnection = new FakeConnection();
    const failedRun = startRun('recovering-run', failedConnection);
    failedRun.writer.send({
      kind: 'error',
      provider: 'claude',
      sessionId: 'native-6',
      content: 'Claude Code process exited with code 1',
    });
    failedRun.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-6', exitCode: 1 });
    assert.equal(sessionRunFailuresDb.listBySession('recovering-run').length, 1);

    // The session recovers: the old failure no longer explains anything and
    // must stop rendering at the tail of the transcript.
    chatRunRegistry.clearAll();
    const okRun = chatRunRegistry.startRun({
      appSessionId: 'recovering-run',
      provider: 'claude',
      providerSessionId: null,
      connection: new FakeConnection(),
      userId: 'user-1',
    });
    assert.ok(okRun);
    okRun.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-6', exitCode: 0 });

    assert.equal(sessionRunFailuresDb.listBySession('recovering-run').length, 0);
  });
});

test('failures are capped per session and keep the newest', async () => {
  await withIsolatedDatabase(() => {
    for (let attempt = 0; attempt < 55; attempt += 1) {
      sessionRunFailuresDb.recordFailure({
        sessionId: 'noisy-session',
        provider: 'claude',
        errorMessage: `failure ${attempt}`,
        exitCode: 1,
        failedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, attempt)),
      });
    }

    const failures = sessionRunFailuresDb.listBySession('noisy-session');
    assert.equal(failures.length, 50);
    assert.equal(failures[0]?.error_message, 'failure 5');
    assert.equal(failures.at(-1)?.error_message, 'failure 54');
  });
});
