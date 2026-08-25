/**
 * Who may touch a handoff message, and how a state change is applied.
 *
 * Kept apart from the service so the two authorization questions ("is the
 * caller a participant?", "is the caller the recipient?") have one answer each,
 * used by every operation, instead of being re-derived per method.
 *
 * A message the caller is not a participant in answers "not found" rather than
 * "forbidden": a session must not be able to probe another session's mailbox
 * for which message ids exist.
 */

import { agentMessagesDb, type AgentMessageRow, type AgentMessageState } from '@/modules/database/index.js';

import {
  AgentMessageInvalidTransitionError,
  AgentMessageNotAddressedError,
  AgentMessageNotFoundError,
} from './agent-messages.errors.js';
import { statesAllowedToReach } from './agent-messages.state.js';

export function requireMessage(messageId: string): AgentMessageRow {
  const message = agentMessagesDb.get(messageId);
  if (!message) {
    throw new AgentMessageNotFoundError(messageId);
  }
  return message;
}

/** Resolves a message the caller is on either side of. */
export function requireParticipant(sessionId: string, messageId: string): AgentMessageRow {
  const message = requireMessage(messageId);
  if (message.from_session_id !== sessionId && message.to_session_id !== sessionId) {
    throw new AgentMessageNotAddressedError(messageId);
  }
  return message;
}

/** Resolves a message addressed *to* the caller — ack and answer are the recipient's to make. */
export function requireRecipient(sessionId: string, messageId: string): AgentMessageRow {
  const message = requireParticipant(sessionId, messageId);
  if (message.to_session_id !== sessionId) {
    throw new AgentMessageNotAddressedError(messageId);
  }
  return message;
}

/**
 * Applies one state-machine move, or explains why it is not available.
 *
 * The legal source states are pushed into the UPDATE's WHERE clause, so the
 * check and the write are a single statement; a null result means another
 * caller moved the message first, and the fresh row says what it moved to.
 */
export function applyTransition(
  message: AgentMessageRow,
  to: AgentMessageState,
  detail?: string | null,
): AgentMessageRow {
  const updated = agentMessagesDb.transition(message.message_id, to, statesAllowedToReach(to), detail);
  if (!updated) {
    const current = agentMessagesDb.get(message.message_id) ?? message;
    throw new AgentMessageInvalidTransitionError(message.message_id, current.state, to);
  }
  return updated;
}
