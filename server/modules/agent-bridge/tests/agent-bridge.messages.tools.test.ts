/**
 * Dispatch tests for the `message_*` bridge tools.
 *
 * What matters here is the wiring the messages module cannot enforce on its
 * own: the acting session always comes from the verified token, and asking for
 * an inbox goes down the pulling path (which delivers) while asking for an
 * outbox goes down the read-only one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runAgentBridgeTool } from '@/modules/agent-bridge/agent-bridge.tools.js';
import type { AgentMessageRow } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

import { createBridgeDeps, MESSAGE, SCOPE } from './support/fake-bridge-deps.js';

test('message_send posts as the token session, never as a session named in the body', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'message_send',
    {
      toSessionId: 'session-2',
      subject: 'Take the parser fix',
      body: 'Branch feat/parser is ready.',
      // A sender field in the payload must be ignored, not trusted.
      fromSessionId: 'session-somebody-else',
    },
    SCOPE,
    deps,
  )) as { message: AgentMessageRow };

  assert.equal(result.message.from_session_id, SCOPE.sessionId);
  assert.equal(result.message.to_session_id, 'session-2');
  assert.equal(deps.messageCalls.send.length, 1);
  assert.equal(deps.messageCalls.send[0]![0], SCOPE.sessionId);
});

test('message_send forwards an optional reply link', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'message_send',
    {
      toSessionId: 'session-2',
      subject: 'Follow-up',
      body: 'One more thing.',
      replyToMessageId: MESSAGE.message_id,
    },
    SCOPE,
    deps,
  )) as { message: AgentMessageRow };

  assert.equal(result.message.reply_to_message_id, MESSAGE.message_id);
});

test('message_send lets the messages module reject a malformed handoff', async () => {
  const deps = createBridgeDeps({
    messages: {
      send: () => {
        throw new AppError('subject is required.', {
          code: 'AGENT_MESSAGE_VALIDATION_ERROR',
          statusCode: 400,
        });
      },
      list: () => [],
      pullInbox: () => [],
      acknowledge: () => MESSAGE,
      answer: () => ({ message: MESSAGE, reply: MESSAGE }),
    },
  });

  const error = await runAgentBridgeTool('message_send', { toSessionId: 'session-2' }, SCOPE, deps).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_MESSAGE_VALIDATION_ERROR');
  assert.equal(error.statusCode, 400);
});

test('message_list defaults to the inbox and pulling it is what delivers', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool('message_list', {}, SCOPE, deps)) as {
    box: string;
    messages: AgentMessageRow[];
  };

  assert.equal(result.box, 'inbox');
  assert.deepEqual(result.messages.map((row) => row.state), ['delivered']);
  assert.deepEqual(deps.messageCalls.pullInbox, [[SCOPE.sessionId, { state: undefined }]]);
  assert.equal(deps.messageCalls.list.length, 0);
});

test('message_list on the outbox reads without delivering anything', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool('message_list', { box: 'outbox' }, SCOPE, deps)) as {
    box: string;
    messages: AgentMessageRow[];
  };

  assert.equal(result.box, 'outbox');
  assert.deepEqual(result.messages.map((row) => row.from_session_id), [SCOPE.sessionId]);
  assert.deepEqual(deps.messageCalls.list, [[SCOPE.sessionId, { box: 'outbox', state: undefined }]]);
  assert.equal(deps.messageCalls.pullInbox.length, 0);
});

test('message_list forwards a state filter to whichever box was asked for', async () => {
  const deps = createBridgeDeps();

  await runAgentBridgeTool('message_list', { state: 'queued' }, SCOPE, deps);
  await runAgentBridgeTool('message_list', { box: 'outbox', state: 'answered' }, SCOPE, deps);

  assert.deepEqual(deps.messageCalls.pullInbox, [[SCOPE.sessionId, { state: 'queued' }]]);
  assert.deepEqual(deps.messageCalls.list, [[SCOPE.sessionId, { box: 'outbox', state: 'answered' }]]);
});

test('message_list rejects an unknown box before calling the service', async () => {
  const deps = createBridgeDeps();

  const error = await runAgentBridgeTool('message_list', { box: 'archive' }, SCOPE, deps).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_BRIDGE_VALIDATION_ERROR');
  assert.equal(error.statusCode, 400);
  assert.equal(deps.messageCalls.pullInbox.length, 0);
  assert.equal(deps.messageCalls.list.length, 0);
});

test('message_ack acknowledges as the token session', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'message_ack',
    { messageId: MESSAGE.message_id },
    SCOPE,
    deps,
  )) as { message: AgentMessageRow };

  assert.equal(result.message.state, 'acknowledged');
  assert.deepEqual(deps.messageCalls.acknowledge, [[SCOPE.sessionId, MESSAGE.message_id]]);
});

test('message_answer settles the original and returns the linked reply', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'message_answer',
    { messageId: MESSAGE.message_id, body: 'Merged, tests green.' },
    SCOPE,
    deps,
  )) as { message: AgentMessageRow; reply: AgentMessageRow };

  assert.equal(result.message.state, 'answered');
  assert.equal(result.reply.reply_to_message_id, MESSAGE.message_id);
  assert.equal(result.reply.from_session_id, SCOPE.sessionId);
  assert.equal(result.reply.to_session_id, MESSAGE.from_session_id);
  assert.equal(result.reply.body, 'Merged, tests green.');

  const [sessionId, messageId] = deps.messageCalls.answer[0]!;
  assert.equal(sessionId, SCOPE.sessionId);
  assert.equal(messageId, MESSAGE.message_id);
});

test('an invalid transition from the messages module reaches the agent as a 409', async () => {
  const deps = createBridgeDeps({
    messages: {
      send: () => MESSAGE,
      list: () => [],
      pullInbox: () => [],
      acknowledge: () => {
        throw new AppError('Message "message-1" cannot move from "queued" to "acknowledged"', {
          code: 'AGENT_MESSAGE_INVALID_TRANSITION',
          statusCode: 409,
        });
      },
      answer: () => ({ message: MESSAGE, reply: MESSAGE }),
    },
  });

  const error = await runAgentBridgeTool('message_ack', { messageId: MESSAGE.message_id }, SCOPE, deps).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_MESSAGE_INVALID_TRANSITION');
  assert.equal(error.statusCode, 409);
  assert.match(error.message, /cannot move from "queued"/);
});
