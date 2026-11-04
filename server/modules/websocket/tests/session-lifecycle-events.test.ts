import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import {
  sessionLifecycleEvents,
  type SessionLifecycleTransition,
} from '@/modules/websocket/services/session-lifecycle.events.js';

class FakeConnection {
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];
  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: (seen: SessionLifecycleTransition[]) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-lifecycle-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const seen: SessionLifecycleTransition[] = [];
  const unsubscribe = sessionLifecycleEvents.onTransition((transition) => seen.push(transition));
  try {
    await runTest(seen);
  } finally {
    unsubscribe();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function startRun(sessionId: string) {
  sessionsDb.createAppSession(sessionId, 'claude', '/workspace/demo');
  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider: 'claude',
    providerSessionId: 'native-1',
    connection: new FakeConnection(),
    userId: 'user-1',
  });
  assert.ok(run);
  return run;
}

test('a clean complete announces idle with the run timing and the final seq', async () => {
  await withIsolatedDatabase((seen) => {
    const run = startRun('lc-idle');
    run.writer.send({ kind: 'text', provider: 'claude', sessionId: 'native-1', role: 'assistant', content: 'done' });
    run.writer.sendComplete({ exitCode: 0 });

    assert.equal(seen.length, 1);
    const [transition] = seen;
    assert.equal(transition?.status, 'idle');
    assert.equal(transition?.sessionId, 'lc-idle');
    assert.equal(transition?.lastSeq, 2);
    assert.equal(transition?.exitCode, 0);
    assert.equal(transition?.aborted, false);
    assert.ok(transition?.startedAt && transition?.finishedAt);
    assert.equal(transition?.error, null);
  });
});

test('an abort is idle, not error, and a failing exit carries the last error text', async () => {
  await withIsolatedDatabase((seen) => {
    const aborted = startRun('lc-abort');
    aborted.writer.sendComplete({ exitCode: 1, aborted: true });
    assert.equal(seen[0]?.status, 'idle');
    assert.equal(seen[0]?.aborted, true);

    const failed = startRun('lc-fail');
    failed.writer.send({ kind: 'error', provider: 'claude', sessionId: 'native-1', content: 'plan limit reached' });
    failed.writer.sendComplete({ exitCode: 1 });
    assert.equal(seen[1]?.status, 'error');
    assert.equal(seen[1]?.error, 'plan limit reached');
    assert.equal(seen[1]?.exitCode, 1);
  });
});

test('a permission request announces waiting_approval once per request id, only while running', async () => {
  await withIsolatedDatabase((seen) => {
    const run = startRun('lc-approval');
    run.writer.send({ kind: 'permission_request', provider: 'claude', sessionId: 'native-1', requestId: 'req-1', toolName: 'Bash' });
    run.writer.send({ kind: 'permission_request', provider: 'claude', sessionId: 'native-1', requestId: 'req-1', toolName: 'Bash' });
    run.writer.send({ kind: 'permission_request', provider: 'claude', sessionId: 'native-1', requestId: 'req-2', toolName: 'Edit' });

    assert.deepEqual(seen.map((t) => [t.status, t.requestId]), [['waiting_approval', 'req-1'], ['waiting_approval', 'req-2']]);
    assert.equal(seen[0]?.finishedAt, null);

    run.writer.sendComplete({ exitCode: 0 });
    assert.equal(seen.length, 3);
    assert.equal(seen[2]?.status, 'idle');
  });
});

test('a listener that throws never breaks the event path', async () => {
  await withIsolatedDatabase((seen) => {
    const unsubscribe = sessionLifecycleEvents.onTransition(() => {
      throw new Error('boom');
    });
    try {
      const run = startRun('lc-throw');
      const connection = run.writer.ws as unknown as FakeConnection;
      run.writer.sendComplete({ exitCode: 0 });
      assert.equal(connection.frames.at(-1)?.kind, 'complete');
      assert.equal(seen.length, 1);
    } finally {
      unsubscribe();
    }
  });
});
