import assert from 'node:assert/strict';
import test from 'node:test';

import { edgeStateStyle, sessionStateDotClassName } from './teamViewStateStyles';

test('edgeStateStyle covers every AgentMessageState with a distinct color class', () => {
  const states = ['queued', 'delivered', 'acknowledged', 'answered', 'failed'] as const;
  const classNames = states.map((state) => edgeStateStyle(state).colorClassName);

  assert.equal(new Set(classNames).size, states.length);
});

test('settled states (answered/failed) render a solid line, others dashed', () => {
  assert.equal(edgeStateStyle('answered').dashArray, undefined);
  assert.equal(edgeStateStyle('failed').dashArray, undefined);
  assert.ok(edgeStateStyle('queued').dashArray);
  assert.ok(edgeStateStyle('delivered').dashArray);
  assert.ok(edgeStateStyle('acknowledged').dashArray);
});

test('sessionStateDotClassName maps running to success and idle to muted', () => {
  assert.equal(sessionStateDotClassName('running'), 'bg-success');
  assert.equal(sessionStateDotClassName('idle'), 'bg-muted-foreground');
});
