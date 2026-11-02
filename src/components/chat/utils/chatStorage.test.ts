import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearQueuedMessage,
  queuedMessageKey,
  readQueuedMessage,
  readQueuedMessages,
  writeQueuedMessages,
} from './chatStorage';

// Node has no localStorage; a Map-backed shim is enough for the storage helpers.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  get length() {
    return store.size;
  },
};

const SESSION = 'session-1';

beforeEach(() => {
  store.clear();
});

test('reads a legacy single-object queued message as a one-item queue', () => {
  store.set(queuedMessageKey(SESSION), JSON.stringify({ content: 'hello', options: { model: 'x' } }));
  assert.deepEqual(readQueuedMessages(SESSION), [{ content: 'hello', options: { model: 'x' } }]);
  assert.deepEqual(readQueuedMessage(SESSION), { content: 'hello', options: { model: 'x' } });
});

test('reads legacy raw text as a one-item queue', () => {
  store.set(queuedMessageKey(SESSION), 'plain draft text');
  assert.deepEqual(readQueuedMessages(SESSION), [{ content: 'plain draft text' }]);
});

test('round-trips a queue in order', () => {
  const queue = [{ content: 'first', options: { permissionMode: 'default' } }, { content: 'second' }];
  writeQueuedMessages(SESSION, queue);
  assert.deepEqual(readQueuedMessages(SESSION), queue);
  assert.equal(readQueuedMessage(SESSION)?.content, 'first');
});

test('drops blank and malformed entries', () => {
  store.set(
    queuedMessageKey(SESSION),
    JSON.stringify([{ content: '   ' }, { content: 'keep' }, { nope: true }, 42, null, { content: '' }]),
  );
  assert.deepEqual(readQueuedMessages(SESSION), [{ content: 'keep' }]);
});

test('writing an empty queue removes the key', () => {
  writeQueuedMessages(SESSION, [{ content: 'a' }]);
  assert.ok(store.has(queuedMessageKey(SESSION)));
  writeQueuedMessages(SESSION, []);
  assert.equal(store.has(queuedMessageKey(SESSION)), false);
  assert.deepEqual(readQueuedMessages(SESSION), []);
  assert.equal(readQueuedMessage(SESSION), null);
});

test('clearQueuedMessage removes the whole queue', () => {
  writeQueuedMessages(SESSION, [{ content: 'a' }, { content: 'b' }]);
  clearQueuedMessage(SESSION);
  assert.deepEqual(readQueuedMessages(SESSION), []);
});
