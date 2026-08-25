import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_MESSAGE_STATES,
  canTransition,
  isAgentMessageState,
  isTerminalAgentMessageState,
  statesAllowedToReach,
} from '@/modules/agent-messages/agent-messages.state.js';

test('the happy path walks queued to answered one step at a time', () => {
  assert.equal(canTransition('queued', 'delivered'), true);
  assert.equal(canTransition('delivered', 'acknowledged'), true);
  assert.equal(canTransition('acknowledged', 'answered'), true);
});

test('a message cannot be acknowledged before it was delivered', () => {
  assert.equal(canTransition('queued', 'acknowledged'), false);
  assert.equal(canTransition('queued', 'answered'), false);
});

test('answering a delivered message is allowed without a separate ack', () => {
  assert.equal(canTransition('delivered', 'answered'), true);
});

test('every non-terminal state can fail', () => {
  assert.equal(canTransition('queued', 'failed'), true);
  assert.equal(canTransition('delivered', 'failed'), true);
  assert.equal(canTransition('acknowledged', 'failed'), true);
});

test('answered and failed are terminal and reopen from nothing', () => {
  assert.equal(isTerminalAgentMessageState('answered'), true);
  assert.equal(isTerminalAgentMessageState('failed'), true);

  for (const state of AGENT_MESSAGE_STATES) {
    assert.equal(canTransition('answered', state), false, `answered → ${state}`);
    assert.equal(canTransition('failed', state), false, `failed → ${state}`);
  }
});

test('no state transitions to itself', () => {
  for (const state of AGENT_MESSAGE_STATES) {
    assert.equal(canTransition(state, state), false, `${state} → ${state}`);
  }
});

test('a message never moves back to queued', () => {
  for (const state of AGENT_MESSAGE_STATES) {
    assert.equal(canTransition(state, 'queued'), false, `${state} → queued`);
  }
  assert.deepEqual(statesAllowedToReach('queued'), []);
});

test('statesAllowedToReach is the inverse of canTransition', () => {
  for (const to of AGENT_MESSAGE_STATES) {
    const allowed = statesAllowedToReach(to);
    for (const from of AGENT_MESSAGE_STATES) {
      assert.equal(
        allowed.includes(from),
        canTransition(from, to),
        `${from} → ${to} disagrees between the two views`,
      );
    }
  }
});

test('isAgentMessageState accepts only the five known states', () => {
  for (const state of AGENT_MESSAGE_STATES) {
    assert.equal(isAgentMessageState(state), true);
  }
  assert.equal(isAgentMessageState('read'), false);
  assert.equal(isAgentMessageState(''), false);
  assert.equal(isAgentMessageState(undefined), false);
  assert.equal(isAgentMessageState(3), false);
});
