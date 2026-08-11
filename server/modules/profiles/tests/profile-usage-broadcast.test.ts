import assert from 'node:assert/strict';
import test from 'node:test';

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import { broadcastProfileUsage } from '@/modules/profiles/usage/profile-usage-broadcast.js';
import type { ProfileUsageEnvelope } from '@/modules/profiles/usage/profile-usage.types.js';

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

const ENVELOPE: ProfileUsageEnvelope = {
  profileId: 'profile-1',
  state: 'cached',
  snapshot: {
    supported: true,
    status: 'ok',
    windows: [],
    plan: 'max',
    asOf: '2026-08-10T00:00:00.000Z',
    fetchedAt: '2026-08-10T00:00:00.000Z',
  },
};

test('broadcastProfileUsage sends to open clients and skips closed ones', () => {
  const open = fakeClient(WS_OPEN_STATE);
  const closed = fakeClient(WS_CLOSED_STATE);
  connectedClients.add(open);
  connectedClients.add(closed);

  try {
    broadcastProfileUsage(ENVELOPE);

    assert.equal(open.messages.length, 1);
    const parsed = JSON.parse(open.messages[0]!);
    assert.equal(parsed.kind, 'profile_usage');
    assert.deepEqual(parsed.envelope, ENVELOPE);

    assert.equal(closed.messages.length, 0, 'a non-OPEN client must never receive the broadcast');
  } finally {
    connectedClients.delete(open);
    connectedClients.delete(closed);
  }
});

test('broadcastProfileUsage is a no-op with no connected clients', () => {
  assert.equal(connectedClients.size, 0);
  assert.doesNotThrow(() => broadcastProfileUsage(ENVELOPE));
});

test('broadcastProfileUsage keeps delivering to later clients when an earlier one throws on send', () => {
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
    assert.doesNotThrow(() => broadcastProfileUsage(ENVELOPE));
    assert.equal(healthy.messages.length, 1, 'a client after the throwing one must still receive the broadcast');
  } finally {
    connectedClients.delete(throwing);
    connectedClients.delete(healthy);
  }
});
