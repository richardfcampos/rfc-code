import assert from 'node:assert/strict';
import test from 'node:test';

import { broadcastAgentMessageUpdate } from '@/modules/agent-messages/agent-message-broadcast.js';
import type { AgentMessageRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';

const WS_CLOSED_STATE = 3;

function fakeClient(readyState: number): { readyState: number; send: (data: string) => void; messages: string[] } {
  const messages: string[] = [];
  return {
    readyState,
    send: (data: string) => {
      messages.push(data);
    },
    messages,
  };
}

const MESSAGE: AgentMessageRow = {
  message_id: 'message-1',
  from_session_id: 'session-maestro',
  to_session_id: 'session-worker',
  subject: 'Review the parser fix',
  body: 'Branch feat/parser is ready.',
  state: 'queued',
  reply_to_message_id: null,
  detail: null,
  created_at: '2026-08-20T00:00:00.000Z',
  updated_at: '2026-08-20T00:00:00.000Z',
};

test('the frame carries the whole message row so clients need no diff replay', () => {
  const open = fakeClient(WS_OPEN_STATE);
  const closed = fakeClient(WS_CLOSED_STATE);
  connectedClients.add(open);
  connectedClients.add(closed);

  try {
    broadcastAgentMessageUpdate(MESSAGE, 'created');

    assert.equal(open.messages.length, 1);
    const parsed = JSON.parse(open.messages[0]!);
    assert.equal(parsed.kind, 'agent_message_update');
    assert.equal(parsed.action, 'created');
    assert.deepEqual(parsed.message, MESSAGE);

    assert.equal(closed.messages.length, 0, 'a non-OPEN client must never receive the broadcast');
  } finally {
    connectedClients.delete(open);
    connectedClients.delete(closed);
  }
});

test('a state change is broadcast as an update, with the new state on the row', () => {
  const open = fakeClient(WS_OPEN_STATE);
  connectedClients.add(open);

  try {
    broadcastAgentMessageUpdate({ ...MESSAGE, state: 'answered' }, 'updated');

    const parsed = JSON.parse(open.messages[0]!);
    assert.equal(parsed.action, 'updated');
    assert.equal(parsed.message.state, 'answered');
  } finally {
    connectedClients.delete(open);
  }
});

test('broadcasting with no connected clients is a no-op', () => {
  assert.equal(connectedClients.size, 0);
  assert.doesNotThrow(() => broadcastAgentMessageUpdate(MESSAGE, 'updated'));
});

test('a client throwing mid-send does not stop the broadcast reaching the others', () => {
  const throwing = {
    readyState: WS_OPEN_STATE,
    send: () => {
      throw new Error('socket closed mid-send');
    },
  };
  const healthy = fakeClient(WS_OPEN_STATE);
  connectedClients.add(throwing);
  connectedClients.add(healthy);

  try {
    assert.doesNotThrow(() => broadcastAgentMessageUpdate(MESSAGE, 'updated'));
    assert.equal(healthy.messages.length, 1, 'a client after the throwing one must still receive the broadcast');
  } finally {
    connectedClients.delete(throwing);
    connectedClients.delete(healthy);
  }
});
