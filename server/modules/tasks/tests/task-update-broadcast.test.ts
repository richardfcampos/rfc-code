import assert from 'node:assert/strict';
import test from 'node:test';

import type { TaskRow } from '@/modules/database/index.js';
import { broadcastTaskUpdate } from '@/modules/tasks/task-update-broadcast.js';
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

const TASK: TaskRow = {
  id: 'task-1',
  project_name: 'my-app',
  title: 'Ship it',
  description: null,
  stage: 'backlog',
  origin: 'user',
  origin_detail: null,
  assignee_profile_id: null,
  suggested_skill: null,
  worktree_branch: null,
  created_at: '2026-08-10T00:00:00.000Z',
  updated_at: '2026-08-10T00:00:00.000Z',
};

test('broadcastTaskUpdate sends to open clients and skips closed ones', () => {
  const open = fakeClient(WS_OPEN_STATE);
  const closed = fakeClient(WS_CLOSED_STATE);
  connectedClients.add(open);
  connectedClients.add(closed);

  try {
    broadcastTaskUpdate(TASK, 'created');

    assert.equal(open.messages.length, 1);
    const parsed = JSON.parse(open.messages[0]!);
    assert.equal(parsed.kind, 'task_update');
    assert.equal(parsed.action, 'created');
    assert.deepEqual(parsed.task, TASK);

    assert.equal(closed.messages.length, 0, 'a non-OPEN client must never receive the broadcast');
  } finally {
    connectedClients.delete(open);
    connectedClients.delete(closed);
  }
});

test('broadcastTaskUpdate is a no-op with no connected clients', () => {
  assert.equal(connectedClients.size, 0);
  assert.doesNotThrow(() => broadcastTaskUpdate(TASK, 'updated'));
});

test('broadcastTaskUpdate keeps delivering to later clients when an earlier one throws on send', () => {
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
    assert.doesNotThrow(() => broadcastTaskUpdate(TASK, 'deleted'));
    assert.equal(healthy.messages.length, 1, 'a client after the throwing one must still receive the broadcast');
  } finally {
    connectedClients.delete(throwing);
    connectedClients.delete(healthy);
  }
});
