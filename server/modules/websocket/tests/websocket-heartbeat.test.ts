import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachConnectionHeartbeat,
  type HeartbeatSocket,
} from '@/modules/websocket/services/websocket-server.service.js';

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;

/**
 * Minimal `ws.WebSocket` stand-in exposing only what `attachConnectionHeartbeat`
 * touches, so pong/terminate timing can be driven deterministically with the
 * test runner's mock timers instead of a real socket and real 30s waits.
 */
class FakeHeartbeatSocket implements HeartbeatSocket {
  readyState = OPEN;
  OPEN = OPEN;
  pingCalls = 0;
  terminated = false;
  private listeners = new Map<string, Set<() => void>>();

  ping(): void {
    this.pingCalls += 1;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = CLOSED;
    this.emit('close');
  }

  on(event: 'pong' | 'close' | 'error', listener: () => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
    return this;
  }

  off(event: 'pong' | 'close' | 'error', listener: () => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: 'pong' | 'close' | 'error'): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }
}

test('keeps pinging on schedule while pongs arrive every cycle', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    const socket = new FakeHeartbeatSocket();
    attachConnectionHeartbeat(socket, { intervalMs: 1000, maxMissedPongs: 2 });

    t.mock.timers.tick(1000);
    assert.equal(socket.pingCalls, 1);
    socket.emit('pong');

    t.mock.timers.tick(1000);
    assert.equal(socket.pingCalls, 2);
    socket.emit('pong');

    t.mock.timers.tick(1000);
    assert.equal(socket.pingCalls, 3);
    assert.equal(socket.terminated, false);
  } finally {
    t.mock.timers.reset();
  }
});

test('tolerates a single missed pong without terminating', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    const socket = new FakeHeartbeatSocket();
    attachConnectionHeartbeat(socket, { intervalMs: 1000, maxMissedPongs: 2 });

    t.mock.timers.tick(1000); // ping #1, no pong reply this cycle
    assert.equal(socket.pingCalls, 1);

    t.mock.timers.tick(1000); // one missed pong tolerated — still pings again
    assert.equal(socket.pingCalls, 2);
    assert.equal(socket.terminated, false);

    socket.emit('pong'); // recovers before the next tick
    t.mock.timers.tick(1000);
    assert.equal(socket.pingCalls, 3);
    assert.equal(socket.terminated, false);
  } finally {
    t.mock.timers.reset();
  }
});

test('terminates after two consecutive missed pongs', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    const socket = new FakeHeartbeatSocket();
    attachConnectionHeartbeat(socket, { intervalMs: 1000, maxMissedPongs: 2 });

    t.mock.timers.tick(1000); // ping #1, never answered
    assert.equal(socket.pingCalls, 1);

    t.mock.timers.tick(1000); // 1st missed pong — ping #2, still not answered
    assert.equal(socket.pingCalls, 2);
    assert.equal(socket.terminated, false);

    t.mock.timers.tick(1000); // 2nd consecutive missed pong — terminate, no 3rd ping
    assert.equal(socket.terminated, true);
    assert.equal(socket.pingCalls, 2);
  } finally {
    t.mock.timers.reset();
  }
});

test('stop() clears the interval and detaches the pong listener', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    const socket = new FakeHeartbeatSocket();
    const stop = attachConnectionHeartbeat(socket, { intervalMs: 1000, maxMissedPongs: 2 });

    stop();
    t.mock.timers.tick(5000);
    assert.equal(socket.pingCalls, 0);
    assert.equal(socket.terminated, false);
  } finally {
    t.mock.timers.reset();
  }
});

test('skips ping cycles while the socket is not OPEN', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    const socket = new FakeHeartbeatSocket();
    socket.readyState = CONNECTING;
    attachConnectionHeartbeat(socket, { intervalMs: 1000, maxMissedPongs: 2 });

    t.mock.timers.tick(3000);
    assert.equal(socket.pingCalls, 0);
    assert.equal(socket.terminated, false);
  } finally {
    t.mock.timers.reset();
  }
});

test('stops the interval when the socket closes on its own', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  try {
    const socket = new FakeHeartbeatSocket();
    attachConnectionHeartbeat(socket, { intervalMs: 1000, maxMissedPongs: 2 });

    socket.emit('close'); // e.g. the remote end closed cleanly
    t.mock.timers.tick(5000);
    assert.equal(socket.pingCalls, 0);
  } finally {
    t.mock.timers.reset();
  }
});
