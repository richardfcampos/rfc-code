import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeReconnectDelayMs,
  hasLivenessProbeTimedOut,
  shouldReconnectImmediatelyOnWake,
} from './websocket-liveness';

test('computeReconnectDelayMs doubles from the base delay each attempt', () => {
  assert.equal(computeReconnectDelayMs(0), 1000);
  assert.equal(computeReconnectDelayMs(1), 2000);
  assert.equal(computeReconnectDelayMs(2), 4000);
  assert.equal(computeReconnectDelayMs(3), 8000);
});

test('computeReconnectDelayMs caps at maxMs for later attempts', () => {
  assert.equal(computeReconnectDelayMs(4), 15000);
  assert.equal(computeReconnectDelayMs(10), 15000);
});

test('computeReconnectDelayMs treats a negative attempt as zero', () => {
  assert.equal(computeReconnectDelayMs(-1), 1000);
});

test('computeReconnectDelayMs honors custom base/cap options', () => {
  assert.equal(computeReconnectDelayMs(1, { baseMs: 500, maxMs: 4000 }), 1000);
  assert.equal(computeReconnectDelayMs(5, { baseMs: 500, maxMs: 4000 }), 4000);
});

test('hasLivenessProbeTimedOut is false once the timeout window has not elapsed', () => {
  assert.equal(
    hasLivenessProbeTimedOut({
      probeSentAt: 1000,
      lastActivityAt: null,
      now: 1500,
      timeoutMs: 2000,
    }),
    false,
  );
});

test('hasLivenessProbeTimedOut is true once the timeout window elapses with no activity', () => {
  assert.equal(
    hasLivenessProbeTimedOut({
      probeSentAt: 1000,
      lastActivityAt: null,
      now: 3000,
      timeoutMs: 2000,
    }),
    true,
  );
});

test('hasLivenessProbeTimedOut is false when activity arrived after the probe was sent', () => {
  assert.equal(
    hasLivenessProbeTimedOut({
      probeSentAt: 1000,
      lastActivityAt: 1200,
      now: 3000,
      timeoutMs: 2000,
    }),
    false,
  );
});

test('hasLivenessProbeTimedOut ignores stale activity from before the probe was sent', () => {
  assert.equal(
    hasLivenessProbeTimedOut({
      probeSentAt: 2000,
      lastActivityAt: 500,
      now: 4500,
      timeoutMs: 2000,
    }),
    true,
  );
});

test('shouldReconnectImmediatelyOnWake is false when the socket is OPEN', () => {
  assert.equal(shouldReconnectImmediatelyOnWake(1, 1), false);
});

test('shouldReconnectImmediatelyOnWake is true for CONNECTING/CLOSING/CLOSED', () => {
  const OPEN = 1;
  assert.equal(shouldReconnectImmediatelyOnWake(0, OPEN), true); // CONNECTING
  assert.equal(shouldReconnectImmediatelyOnWake(2, OPEN), true); // CLOSING
  assert.equal(shouldReconnectImmediatelyOnWake(3, OPEN), true); // CLOSED
});
