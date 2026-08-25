/**
 * State machine of a handoff message.
 *
 * ```
 *  queued ──deliver──▶ delivered ──ack──▶ acknowledged ──answer──▶ answered
 *     │                    │                   │
 *     └────fail────────────┴───────────────────┴──────────────────▶ failed
 * ```
 *
 * Two rules shape this table:
 *
 * - `queued → acknowledged` is not allowed. A session cannot acknowledge a
 *   message it never pulled, so delivery is always observed first.
 * - `delivered → answered` *is* allowed. Producing an answer is stronger
 *   evidence of receipt than an ack, so requiring the ack first would only
 *   force agents into a bookkeeping step that proves less than what they just
 *   did.
 *
 * `answered` and `failed` are terminal: a settled handoff never reopens, it is
 * superseded by a new message.
 */

import type { AgentMessageState } from '@/modules/database/index.js';

export const AGENT_MESSAGE_STATES: readonly AgentMessageState[] = [
  'queued',
  'delivered',
  'acknowledged',
  'answered',
  'failed',
];

/** For each state, the states it may move to. */
const TRANSITIONS: Record<AgentMessageState, readonly AgentMessageState[]> = {
  queued: ['delivered', 'failed'],
  delivered: ['acknowledged', 'answered', 'failed'],
  acknowledged: ['answered', 'failed'],
  answered: [],
  failed: [],
};

export function isAgentMessageState(value: unknown): value is AgentMessageState {
  return typeof value === 'string' && AGENT_MESSAGE_STATES.includes(value as AgentMessageState);
}

export function isTerminalAgentMessageState(state: AgentMessageState): boolean {
  return TRANSITIONS[state].length === 0;
}

export function canTransition(from: AgentMessageState, to: AgentMessageState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Every state that may legally move to `to`.
 *
 * This is the form the repository wants: the guard belongs in the UPDATE's
 * WHERE clause, so the check and the write are one atomic statement instead of
 * a read followed by a write that a concurrent agent can slip between.
 */
export function statesAllowedToReach(to: AgentMessageState): readonly AgentMessageState[] {
  return AGENT_MESSAGE_STATES.filter((from) => canTransition(from, to));
}
