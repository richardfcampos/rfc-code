import assert from 'node:assert/strict';
import test from 'node:test';

import { chatRunRegistry } from '@/modules/websocket/index.js';

import type { ChatGatewayDeps } from '../chat-gateway.js';

import { emit, sessionRow, setup, useIsolatedDatabase, type Writer } from './support/chat-gateway-harness.js';

useIsolatedDatabase();

test('approveTool with a sessionId resolves only a request pending on that session', () => {
  const row = sessionRow({ provider_session_id: 'native-3' });
  const decisions: string[] = [];
  const { gateway } = setup(row, {
    resolveToolApproval: (requestId) => decisions.push(requestId),
    getPendingApprovalsForSession: () => [{ requestId: 'r1', toolName: 'Bash' }],
  });
  const unknown = gateway.approveTool({ requestId: 'stale', allow: true, sessionId: row.session_id });
  assert.deepEqual(unknown, { requestId: 'stale', resolved: false, reason: 'UNKNOWN_REQUEST' });
  assert.deepEqual(decisions, [], 'the runtime resolver is not called for an unknown id');
  assert.deepEqual(gateway.approveTool({ requestId: 'r1', allow: true, sessionId: row.session_id }), { requestId: 'r1', resolved: true });
  assert.deepEqual(decisions, ['r1']);
});

test('a throw while starting the turn releases the run and reports TURN_START_FAILED', async () => {
  const row = sessionRow();
  const ended: string[] = [];
  const { gateway, spawnCalls } = setup(row, {
    turnEffects: { begin() { throw new Error('primer store down'); }, end: (id) => { ended.push(id); } },
  });
  await assert.rejects(gateway.send({ sessionId: row.session_id, content: 'x' }), { status: 500, code: 'TURN_START_FAILED' });
  assert.equal(chatRunRegistry.isProcessing(row.session_id), false);
  assert.deepEqual(ended, [row.session_id]);
  assert.equal(spawnCalls.length, 0);
});

test('send forwards the caller user id to the run', async () => {
  const row = sessionRow();
  const seen: unknown[] = [];
  const registry = { ...chatRunRegistry, startRun: (input: { userId: unknown }) => { seen.push(input.userId); return null; } };
  const { gateway } = setup(row, { registry: registry as unknown as ChatGatewayDeps['registry'] });
  await assert.rejects(gateway.send({ sessionId: row.session_id, content: 'x', userId: 7 }), { code: 'RUN_IN_PROGRESS' });
  assert.deepEqual(seen, [7]);
});

test('wait returns only the last frames of a long stream, with lastSeq to resume from', async () => {
  const row = sessionRow();
  const chatty = async (_command: string, _options: Record<string, unknown>, writer: unknown): Promise<void> => {
    for (let index = 0; index < 150; index += 1) emit(writer as Writer, 'stream_delta', { content: 'x' });
    emit(writer as Writer, 'complete', { exitCode: 0 });
  };
  const { gateway } = setup(row, { spawnFns: { claude: chatty } });
  const result = await gateway.send({ sessionId: row.session_id, content: 'hi', wait: true });
  assert.equal(result.completed, true);
  assert.equal(result.text, 'x'.repeat(150), 'text is built from every frame, not just the returned ones');
  assert.equal(result.events?.length, 100);
  assert.equal(result.eventsTruncated, true);
  assert.equal(result.lastSeq, 151);
  assert.equal(result.events?.at(-1)?.kind, 'complete');
});
