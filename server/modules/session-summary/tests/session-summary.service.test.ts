import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionRunFailuresDb, sessionsDb } from '@/modules/database/index.js';
import { buildSessionSummary, configureSessionSummaryRuntime } from '@/modules/session-summary/index.js';
import { MAX_SUMMARY_RESPONSE_CHARS } from '@/modules/session-summary/session-summary.types.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { NormalizedMessage } from '@/shared/types.js';

class FakeConnection {
  readyState = 1;
  send(): void {}
}

/** git is never spawned here: the runner reports "not a repository". */
const noGit = async (): Promise<string> => { throw new Error('not a repo'); };
const noHistory = async (): Promise<{ messages: NormalizedMessage[] }> => ({ messages: [] });
const deps = { gitRunner: noGit, fetchHistory: noHistory };

async function withIsolatedDatabase(run: () => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const dir = await mkdtemp(path.join(tmpdir(), 'session-summary-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(dir, 'auth.db');
  await initializeDatabase();
  configureSessionSummaryRuntime({ getPendingApprovalsForSession: () => [] });
  try {
    await run();
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

function startRun(sessionId: string, provider: 'claude' | 'codex' = 'claude') {
  const run = chatRunRegistry.startRun({ appSessionId: sessionId, provider, providerSessionId: 'native-1', connection: new FakeConnection(), userId: 1 });
  assert.ok(run);
  return run;
}

test('unknown session → 404 AppError', async () => {
  await withIsolatedDatabase(async () => {
    await assert.rejects(buildSessionSummary({ sessionId: 'nope' }, deps), (error: { code?: string; statusCode?: number }) =>
      error.code === 'SESSION_NOT_FOUND' && error.statusCode === 404);
  });
});

test('a session that never ran in this process is idle with no timings and the history text', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('s-idle', 'claude', '/workspace/demo');
    const history = async () => ({
      messages: [
        { id: '1', sessionId: 's-idle', timestamp: 't', provider: 'claude', kind: 'text', role: 'user', content: 'hi' },
        { id: '2', sessionId: 's-idle', timestamp: 't', provider: 'claude', kind: 'text', role: 'assistant', content: 'done, all green' },
      ] as NormalizedMessage[],
    });
    const summary = await buildSessionSummary({ sessionId: 's-idle' }, { gitRunner: noGit, fetchHistory: history });
    assert.equal(summary.status, 'idle');
    assert.equal(summary.startedAt, null);
    assert.equal(summary.durationMs, null);
    assert.equal(summary.lastSeq, 0);
    assert.equal(summary.response, 'done, all green');
    assert.equal(summary.git, null);
    assert.equal(summary.tests, null);
    assert.equal(summary.project.name, 'demo');
    assert.equal(summary.project.path, '/workspace/demo');
  });
});

test('a live run is running, then idle with the assistant text, timings, seq and detected tests', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('s-live', 'claude', '/workspace/demo');
    const run = startRun('s-live');
    run.writer.send({ kind: 'stream_delta', provider: 'claude', sessionId: 'native-1', content: 'wor' });
    assert.equal((await buildSessionSummary({ sessionId: 's-live' }, deps)).status, 'running');

    run.writer.send({ kind: 'tool_result', provider: 'claude', sessionId: 'native-1', content: '# pass 9\n# fail 0\n' });
    run.writer.send({ kind: 'text', provider: 'claude', sessionId: 'native-1', role: 'assistant', content: 'Fixed the bug.' });
    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-1', exitCode: 0 });

    const summary = await buildSessionSummary({ sessionId: 's-live' }, deps);
    assert.equal(summary.status, 'idle');
    assert.equal(summary.error, null);
    assert.equal(summary.response, 'Fixed the bug.');
    assert.equal(summary.lastSeq, 4);
    assert.ok(summary.startedAt && summary.finishedAt);
    assert.ok((summary.durationMs ?? -1) >= 0);
    assert.deepEqual(summary.tests, { runner: 'node:test', passed: 9, failed: 0, total: 9 });

    // sinceSeq hides the earlier events (text at seq 3 is before 3? no: > sinceSeq).
    const later = await buildSessionSummary({ sessionId: 's-live', sinceSeq: 3 }, deps);
    assert.equal(later.response, null);
    assert.equal(later.tests, null);
  });
});

test('a failed run reports error with the last error text; an aborted one is idle', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('s-fail', 'codex', '/workspace/demo');
    const run = startRun('s-fail', 'codex');
    run.writer.send({ kind: 'error', provider: 'codex', sessionId: 'native-1', content: 'rate limited' });
    run.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-1', exitCode: 1 });
    const failed = await buildSessionSummary({ sessionId: 's-fail' }, deps);
    assert.equal(failed.status, 'error');
    assert.equal(failed.error, 'rate limited');

    sessionsDb.createAppSession('s-abort', 'codex', '/workspace/demo');
    const aborted = startRun('s-abort', 'codex');
    aborted.writer.send({ kind: 'complete', provider: 'codex', sessionId: 'native-1', exitCode: 1, aborted: true });
    assert.equal((await buildSessionSummary({ sessionId: 's-abort' }, deps)).status, 'idle');
  });
});

test('with the run buffer gone, a recorded failure newer than the row still reads as error', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('s-old', 'claude', '/workspace/demo');
    sessionRunFailuresDb.recordFailure({ sessionId: 's-old', provider: 'claude', errorMessage: 'The server went down', failedAt: new Date(Date.now() + 60_000) });
    const summary = await buildSessionSummary({ sessionId: 's-old' }, deps);
    assert.equal(summary.status, 'error');
    assert.equal(summary.error, 'The server went down');
  });
});

test('a pending approval turns a running session into waiting_approval with the tool described', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('s-wait', 'claude', '/workspace/demo');
    startRun('s-wait');
    configureSessionSummaryRuntime({
      getPendingApprovalsForSession: (providerSessionId) =>
        providerSessionId === 'native-1' ? [{ requestId: 'req-7', toolName: 'Bash', input: { command: 'rm -rf dist' } }] : [],
    });
    const summary = await buildSessionSummary({ sessionId: 's-wait' }, deps);
    assert.equal(summary.status, 'waiting_approval');
    assert.deepEqual(summary.pendingApproval, { requestId: 'req-7', toolName: 'Bash', description: 'Bash: rm -rf dist' });
  });
});

test('the response is truncated to the cap with a flag', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('s-long', 'claude', '/workspace/demo');
    const run = startRun('s-long');
    // Narration first, the final answer last: the tail is what must survive the cut.
    run.writer.send({ kind: 'text', provider: 'claude', sessionId: 'native-1', role: 'assistant', content: `${'x'.repeat(MAX_SUMMARY_RESPONSE_CHARS + 500)} FINAL ANSWER` });
    run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-1', exitCode: 0 });
    const summary = await buildSessionSummary({ sessionId: 's-long' }, deps);
    assert.equal(summary.responseTruncated, true);
    assert.equal(summary.response?.length, MAX_SUMMARY_RESPONSE_CHARS);
    assert.ok(summary.response?.startsWith('…'));
    assert.ok(summary.response?.endsWith('FINAL ANSWER'));
  });
});
