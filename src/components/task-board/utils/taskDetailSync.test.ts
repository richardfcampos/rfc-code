import assert from 'node:assert/strict';
import test from 'node:test';

import { decideTaskDetailSync } from './taskDetailSync';

function event(overrides: { kind?: string; action?: string; task?: { id?: string } | null } = {}) {
  return { kind: 'task_update', action: 'updated', task: { id: 'task-1' }, ...overrides };
}

test('no open task means every event is ignored', () => {
  assert.equal(decideTaskDetailSync(event(), undefined), 'ignore');
});

test('an update to a different task is ignored', () => {
  assert.equal(decideTaskDetailSync(event({ task: { id: 'task-2' } }), 'task-1'), 'ignore');
});

test('an event with no task payload is ignored', () => {
  assert.equal(decideTaskDetailSync(event({ task: null }), 'task-1'), 'ignore');
});

test('a non task_update kind is ignored even if it carries a matching task id', () => {
  assert.equal(decideTaskDetailSync(event({ kind: 'chat_subscribed' }), 'task-1'), 'ignore');
});

test('an update to the open task triggers a refresh', () => {
  assert.equal(decideTaskDetailSync(event({ action: 'updated' }), 'task-1'), 'refresh');
});

test('a create event for the open task id still refreshes (covers optimistic-id replacement)', () => {
  assert.equal(decideTaskDetailSync(event({ action: 'created' }), 'task-1'), 'refresh');
});

test('a delete of the open task closes the view instead of refetching a 404', () => {
  assert.equal(decideTaskDetailSync(event({ action: 'deleted' }), 'task-1'), 'close');
});
