import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  activeSessionRunsDb,
  closeConnection,
  initializeDatabase,
  sessionRunFailuresDb,
  sessionsDb,
} from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/** Minimal outbound sink; the sweep never looks at what was sent. */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-run-orphan-sweep-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

function startRun(appSessionId: string) {
  sessionsDb.createAppSession(appSessionId, 'claude', '/workspace/demo');
  const run = chatRunRegistry.startRun({
    appSessionId,
    provider: 'claude',
    providerSessionId: null,
    connection: new FakeConnection(),
    userId: 'user-1',
  });
  assert.ok(run);
  return run;
}

test('a started run is marked in flight and the marker goes when it completes', async () => {
  await withIsolatedDatabase(() => {
    const run = startRun('tracked-run');

    assert.deepEqual(
      activeSessionRunsDb.listAll().map((marker) => marker.session_id),
      ['tracked-run'],
    );

    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-1', exitCode: 0 });
    assert.equal(activeSessionRunsDb.listAll().length, 0);
  });
});

test('a failed run clears its marker too', async () => {
  await withIsolatedDatabase(() => {
    const run = startRun('failed-run');
    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-2', exitCode: 1 });

    assert.equal(activeSessionRunsDb.listAll().length, 0);
    assert.equal(sessionRunFailuresDb.listBySession('failed-run').length, 1);
  });
});

test('a run the process never finished is recorded as interrupted at the next boot', async () => {
  await withIsolatedDatabase(() => {
    // The previous process died mid-run: the marker is all it left behind.
    activeSessionRunsDb.markStarted({
      sessionId: 'orphaned-run',
      provider: 'claude',
      startedAt: new Date(Date.now() - 60_000),
    });

    assert.equal(chatRunRegistry.recordRunsInterruptedByCrash(), 1);

    const failures = sessionRunFailuresDb.listBySession('orphaned-run');
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.error_message, 'The server went down while this run was in progress.');
    assert.equal(failures[0]?.provider, 'claude');
    // Swept markers are stale by definition; a second boot must find nothing.
    assert.equal(activeSessionRunsDb.listAll().length, 0);
    assert.equal(chatRunRegistry.recordRunsInterruptedByCrash(), 0);
  });
});

test('a run a graceful shutdown already explained is not recorded twice', async () => {
  await withIsolatedDatabase(() => {
    const startedAt = new Date(Date.now() - 60_000);
    activeSessionRunsDb.markStarted({
      sessionId: 'stopped-run',
      provider: 'claude',
      startedAt,
    });
    // What shutdownRuntimeServices writes on SIGTERM before the process exits.
    sessionRunFailuresDb.recordFailure({
      sessionId: 'stopped-run',
      provider: 'claude',
      errorMessage: 'The server was stopped while this run was in progress.',
      failedAt: new Date(startedAt.getTime() + 1_000),
    });

    assert.equal(chatRunRegistry.recordRunsInterruptedByCrash(), 0);

    const failures = sessionRunFailuresDb.listBySession('stopped-run');
    assert.equal(failures.length, 1);
    assert.match(failures[0]?.error_message ?? '', /was stopped/);
    assert.equal(activeSessionRunsDb.listAll().length, 0);
  });
});

test('a failure from an earlier run does not excuse the interrupted one', async () => {
  await withIsolatedDatabase(() => {
    const startedAt = new Date(Date.now() - 60_000);
    // A previous turn on this session failed and was recorded long before the
    // interrupted run even started.
    sessionRunFailuresDb.recordFailure({
      sessionId: 'reused-session',
      provider: 'claude',
      errorMessage: 'Claude Code process exited with code 1',
      failedAt: new Date(startedAt.getTime() - 10_000),
    });
    activeSessionRunsDb.markStarted({
      sessionId: 'reused-session',
      provider: 'claude',
      startedAt,
    });

    assert.equal(chatRunRegistry.recordRunsInterruptedByCrash(), 1);

    const messages = sessionRunFailuresDb
      .listBySession('reused-session')
      .map((failure) => failure.error_message);
    assert.deepEqual(messages, [
      'Claude Code process exited with code 1',
      'The server went down while this run was in progress.',
    ]);
  });
});

test('the sweep records every provider it finds and empties the table once', async () => {
  await withIsolatedDatabase(() => {
    activeSessionRunsDb.markStarted({ sessionId: 'claude-run', provider: 'claude' });
    activeSessionRunsDb.markStarted({ sessionId: 'codex-run', provider: 'codex' });

    assert.equal(chatRunRegistry.recordRunsInterruptedByCrash(), 2);
    assert.equal(sessionRunFailuresDb.listBySession('claude-run')[0]?.provider, 'claude');
    assert.equal(sessionRunFailuresDb.listBySession('codex-run')[0]?.provider, 'codex');
    assert.equal(activeSessionRunsDb.listAll().length, 0);
  });
});
