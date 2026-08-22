import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRefreshTranscriptAfterRunEnd } from './run-end-transcript-refresh';

const NOW = 1_000_000;
const SESSION = 'session-a';

test('refreshes when a watched run ends without a live complete frame', () => {
  assert.equal(
    shouldRefreshTranscriptAfterRunEnd({
      previous: { sessionId: SESSION, wasProcessing: true },
      sessionId: SESSION,
      isProcessing: false,
      completeReceivedAt: undefined,
      now: NOW,
    }),
    true,
  );
});

test('refreshes when the last complete frame is stale', () => {
  assert.equal(
    shouldRefreshTranscriptAfterRunEnd({
      previous: { sessionId: SESSION, wasProcessing: true },
      sessionId: SESSION,
      isProcessing: false,
      completeReceivedAt: NOW - 60_000,
      now: NOW,
    }),
    true,
  );
});

test('skips when the complete frame just arrived (realtime handler refreshed)', () => {
  assert.equal(
    shouldRefreshTranscriptAfterRunEnd({
      previous: { sessionId: SESSION, wasProcessing: true },
      sessionId: SESSION,
      isProcessing: false,
      completeReceivedAt: NOW - 100,
      now: NOW,
    }),
    false,
  );
});

test('skips on session switch even if the previous session was processing', () => {
  assert.equal(
    shouldRefreshTranscriptAfterRunEnd({
      previous: { sessionId: 'session-b', wasProcessing: true },
      sessionId: SESSION,
      isProcessing: false,
      completeReceivedAt: undefined,
      now: NOW,
    }),
    false,
  );
});

test('skips while the run is still processing', () => {
  assert.equal(
    shouldRefreshTranscriptAfterRunEnd({
      previous: { sessionId: SESSION, wasProcessing: true },
      sessionId: SESSION,
      isProcessing: true,
      completeReceivedAt: undefined,
      now: NOW,
    }),
    false,
  );
});

test('skips a rising edge (idle to processing)', () => {
  assert.equal(
    shouldRefreshTranscriptAfterRunEnd({
      previous: { sessionId: SESSION, wasProcessing: false },
      sessionId: SESSION,
      isProcessing: false,
      completeReceivedAt: undefined,
      now: NOW,
    }),
    false,
  );
});

test('skips when no session is selected', () => {
  assert.equal(
    shouldRefreshTranscriptAfterRunEnd({
      previous: { sessionId: null, wasProcessing: true },
      sessionId: null,
      isProcessing: false,
      completeReceivedAt: undefined,
      now: NOW,
    }),
    false,
  );
});
