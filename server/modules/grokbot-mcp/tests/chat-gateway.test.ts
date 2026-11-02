import assert from 'node:assert/strict';
import test from 'node:test';

import { OrgPolicyError, type OrgPolicyService } from '@/modules/orgs/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

import { answeringSpawn, emit, openPolicy, sessionRow, setup, useIsolatedDatabase } from './support/chat-gateway-harness.js';

useIsolatedDatabase();

test('send without wait starts the run and returns at once', async () => {
  const row = sessionRow();
  const { gateway, spawnCalls, release } = setup(row);
  const result = await gateway.send({ sessionId: row.session_id, content: 'hi', model: 'opus' });
  assert.deepEqual(result, { sessionId: row.session_id, provider: 'claude', started: true });
  assert.equal(chatRunRegistry.isProcessing(row.session_id), true);
  assert.equal(spawnCalls[0]?.command, 'hi');
  assert.equal(spawnCalls[0]?.options.cwd, '/tmp');
  assert.equal(spawnCalls[0]?.options.model, 'opus');
  assert.equal(spawnCalls[0]?.options.resume, false);
  assert.equal(spawnCalls[0]?.options.profileId, null);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(chatRunRegistry.isProcessing(row.session_id), false, 'safety net completes the run');
});

test('send with wait resolves with the assistant text once the run completes', async () => {
  const row = sessionRow();
  const { gateway } = setup(row, { spawnFns: { claude: answeringSpawn } });
  const result = await gateway.send({ sessionId: row.session_id, content: 'hi', wait: true });
  assert.equal(result.completed, true);
  assert.equal(result.text, 'hello from the agent');
  assert.deepEqual(result.events?.map((event) => event.kind), ['text', 'complete']);
  assert.equal(result.events?.[0]?.sessionId, row.session_id, 'provider ids are remapped to the app id');
  assert.equal(result.lastSeq, 2);
  assert.equal(result.eventsTruncated, undefined);
});

test('send with wait reports a timeout and leaves the run going', async () => {
  const row = sessionRow();
  const { gateway, spawnCalls, release } = setup(row);
  const pending = gateway.send({ sessionId: row.session_id, content: 'slow', wait: true, timeoutMs: 100 });
  await new Promise((resolve) => setImmediate(resolve));
  emit(spawnCalls[0]!.writer, 'stream_delta', { content: 'partial' });
  const result = await pending;
  assert.equal(result.completed, false);
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.events?.map((event) => event.kind), ['stream_delta']);
  assert.equal(chatRunRegistry.isProcessing(row.session_id), true);
  release();
});

test('a second send while a run is live is refused with RUN_IN_PROGRESS', async () => {
  const row = sessionRow();
  const { gateway, release } = setup(row);
  await gateway.send({ sessionId: row.session_id, content: 'one' });
  await assert.rejects(gateway.send({ sessionId: row.session_id, content: 'two' }), { status: 409, code: 'RUN_IN_PROGRESS' });
  release();
});

test('unknown session and unsupported provider are refused before any run', async () => {
  const row = sessionRow({ provider: 'nope' });
  const { gateway } = setup(row);
  await assert.rejects(gateway.send({ sessionId: 'missing', content: 'x' }), { status: 404, code: 'SESSION_NOT_FOUND' });
  await assert.rejects(gateway.send({ sessionId: row.session_id, content: 'x' }), { status: 400, code: 'UNSUPPORTED_PROVIDER' });
  assert.equal(chatRunRegistry.getRun(row.session_id), undefined);
});

test('a missing worktree and an org refusal are reported with their codes', async () => {
  const worktreeRow = sessionRow({ worktree_path: '/definitely/not/here' });
  await assert.rejects(setup(worktreeRow).gateway.send({ sessionId: worktreeRow.session_id, content: 'x' }), { status: 409, code: 'WORKTREE_MISSING' });

  const profiledRow = sessionRow({ profile_id: 'blocked' });
  const refusing: OrgPolicyService = { ...openPolicy, assertProfileAllowed() { throw new OrgPolicyError('not in this org'); } };
  await assert.rejects(
    setup(profiledRow, { policy: refusing }).gateway.send({ sessionId: profiledRow.session_id, content: 'x' }),
    { status: 403, code: 'ORG_POLICY_DENIED', message: 'not in this org' },
  );
});

test('abort calls the provider abort with the native id and completes the run', async () => {
  const row = sessionRow({ provider_session_id: 'native-1' });
  const aborted: string[] = [];
  const { gateway, spawnCalls, release } = setup(row, { abortFns: { claude: (id) => { aborted.push(id); return true; } } });
  await gateway.send({ sessionId: row.session_id, content: 'go' });
  assert.equal(spawnCalls[0]?.options.resume, true);
  const result = await gateway.abort(row.session_id);
  assert.deepEqual(result, { sessionId: row.session_id, aborted: true });
  assert.deepEqual(aborted, ['native-1']);
  assert.equal(chatRunRegistry.isProcessing(row.session_id), false);
  const complete = gateway.events(row.session_id, 0).find((event) => event.kind === 'complete');
  assert.equal(complete?.aborted, true);
  release();
});

test('abort without a live run is refused with NO_ACTIVE_RUN', async () => {
  const row = sessionRow();
  await assert.rejects(setup(row).gateway.abort(row.session_id), { status: 409, code: 'NO_ACTIVE_RUN' });
});

test('events replays only what came after afterSeq, and status reflects the run', async () => {
  const row = sessionRow();
  const { gateway, spawnCalls, release } = setup(row);
  await gateway.send({ sessionId: row.session_id, content: 'go' });
  for (const content of ['a', 'b', 'c']) emit(spawnCalls[0]!.writer, 'stream_delta', { content });
  assert.deepEqual(gateway.events(row.session_id, 1).map((event) => event.seq), [2, 3]);
  assert.deepEqual(gateway.status(row.session_id), { sessionId: row.session_id, isProcessing: true, lastSeq: 3, provider: 'claude' });
  assert.deepEqual(gateway.status('never-ran'), { sessionId: 'never-ran', isProcessing: false, lastSeq: 0, provider: null });
  release();
});

test('pendingApprovals asks with the native id and rewrites sessionId to the app id', () => {
  const row = sessionRow({ provider_session_id: 'native-2' });
  const asked: string[] = [];
  const { gateway } = setup(row, {
    getPendingApprovalsForSession: (id) => {
      asked.push(id);
      return [{ requestId: 'r1', sessionId: id, toolName: 'Bash' }];
    },
  });
  assert.deepEqual(gateway.pendingApprovals(row.session_id), [{ requestId: 'r1', sessionId: row.session_id, toolName: 'Bash' }]);
  assert.deepEqual(asked, ['native-2']);
});

test('approveTool forwards the decision to the runtime', () => {
  const row = sessionRow();
  const decisions: unknown[] = [];
  const { gateway } = setup(row, { resolveToolApproval: (requestId, decision) => decisions.push({ requestId, ...decision }) });
  const result = gateway.approveTool({ requestId: 'r9', allow: false, message: 'no' });
  assert.deepEqual(result, { requestId: 'r9', resolved: true });
  assert.deepEqual(decisions, [{ requestId: 'r9', allow: false, updatedInput: undefined, message: 'no' }]);
});
