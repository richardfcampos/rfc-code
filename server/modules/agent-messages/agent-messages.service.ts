/**
 * Application service for the agent-to-agent handoff inbox.
 *
 * Two invariants live here and nowhere else:
 *
 * 1. **The caller is always a session id from a trusted scope**, never a field
 *    from the request body. Every method takes it as its first argument, and
 *    `agent-messages.access.ts` decides which messages that caller may touch.
 * 2. **Delivery means the recipient pulled the message.** There is no push into
 *    a running agent's context, so `pullInbox` — the recipient asking for its
 *    own inbox — is the only thing that moves `queued → delivered`. Read-only
 *    listings (`list`, used by the REST surface a human UI reads) never change
 *    a state, so opening the inbox in a browser cannot forge a delivery.
 */

import {
  agentMessagesDb,
  type AgentMessageRow,
  type AgentMessageState,
} from '@/modules/database/index.js';

import type { AgentMessageUpdateAction } from './agent-message-broadcast.js';
import { applyTransition, requireParticipant, requireRecipient } from './agent-messages.access.js';
import {
  AgentMessageRecipientUnknownError,
  AgentMessageValidationError,
} from './agent-messages.errors.js';
import {
  AGENT_MESSAGE_SUBJECT_MAX_LENGTH,
  validateBody,
  validateBox,
  validateDetail,
  validateMessageId,
  validateOptionalMessageId,
  validateOptionalState,
  validateSessionId,
  validateSubject,
} from './agent-messages.validation.js';

export type AgentMessagesServiceDeps = {
  /** Liveness check for the addressee — a handoff to a session that is gone is refused, not queued forever. */
  sessionExists(sessionId: string): boolean;
  broadcast(message: AgentMessageRow, action: AgentMessageUpdateAction): void;
};

/** Raw request bodies straight off the wire; every field is unvalidated. */
export type AgentMessageRequestBody = Record<string, unknown>;

export type AgentMessageAnswer = {
  /** The original message, now `answered`. */
  message: AgentMessageRow;
  /** The reply it produced, queued in the original sender's inbox. */
  reply: AgentMessageRow;
};

export type AgentMessagesService = {
  send(fromSessionId: string, body: AgentMessageRequestBody): AgentMessageRow;
  list(sessionId: string, filter: AgentMessageRequestBody): AgentMessageRow[];
  pullInbox(sessionId: string, filter: AgentMessageRequestBody): AgentMessageRow[];
  acknowledge(sessionId: string, rawMessageId: unknown): AgentMessageRow;
  answer(sessionId: string, rawMessageId: unknown, body: AgentMessageRequestBody): AgentMessageAnswer;
  fail(sessionId: string, rawMessageId: unknown, reason?: unknown): AgentMessageRow;
};

/** Moves a message and tells the clients, in that order. */
function transitionAndBroadcast(
  deps: AgentMessagesServiceDeps,
  message: AgentMessageRow,
  to: AgentMessageState,
  detail?: string | null,
): AgentMessageRow {
  const updated = applyTransition(message, to, detail);
  deps.broadcast(updated, 'updated');
  return updated;
}

function send(
  deps: AgentMessagesServiceDeps,
  fromSessionId: string,
  body: AgentMessageRequestBody,
): AgentMessageRow {
  const toSessionId = validateSessionId(body.toSessionId, 'toSessionId');
  const subject = validateSubject(body.subject);
  const messageBody = validateBody(body.body);
  const replyToMessageId = validateOptionalMessageId(body.replyToMessageId, 'replyToMessageId');

  if (toSessionId === fromSessionId) {
    throw new AgentMessageValidationError('A session cannot send a handoff message to itself.');
  }
  if (!deps.sessionExists(toSessionId)) {
    throw new AgentMessageRecipientUnknownError(toSessionId);
  }
  if (replyToMessageId) {
    // Threading onto a message the caller cannot see would let one session
    // graft replies into another session's conversation.
    requireParticipant(fromSessionId, replyToMessageId);
  }

  const message = agentMessagesDb.create({
    fromSessionId,
    toSessionId,
    subject,
    body: messageBody,
    replyToMessageId,
  });

  deps.broadcast(message, 'created');
  return message;
}

function list(sessionId: string, filter: AgentMessageRequestBody): AgentMessageRow[] {
  return agentMessagesDb.listForSession(sessionId, {
    box: validateBox(filter.box),
    state: validateOptionalState(filter.state),
  });
}

/**
 * The recipient's own inbox, marking everything still `queued` as delivered.
 *
 * A `state: 'queued'` filter therefore returns rows that now read `delivered`:
 * the caller asked for its new messages and, by receiving them, made them
 * delivered. That is the intended reading, not a leak in the filter.
 */
function pullInbox(
  deps: AgentMessagesServiceDeps,
  sessionId: string,
  filter: AgentMessageRequestBody,
): AgentMessageRow[] {
  const state = validateOptionalState(filter.state);
  const messages = agentMessagesDb.listForSession(sessionId, { box: 'inbox', state });

  return messages.map((message) => {
    if (message.state !== 'queued') {
      return message;
    }
    // A concurrent pull may have delivered it already; that is a benign race,
    // so fall back to whatever the row says now instead of failing the listing.
    const delivered = agentMessagesDb.transition(message.message_id, 'delivered', ['queued']);
    if (!delivered) {
      return agentMessagesDb.get(message.message_id) ?? message;
    }
    deps.broadcast(delivered, 'updated');
    return delivered;
  });
}

function answer(
  deps: AgentMessagesServiceDeps,
  sessionId: string,
  rawMessageId: unknown,
  body: AgentMessageRequestBody,
): AgentMessageAnswer {
  const messageId = validateMessageId(rawMessageId);
  const replyBody = validateBody(body.body);
  const original = requireRecipient(sessionId, messageId);
  const subject =
    body.subject === undefined || body.subject === null
      ? `Re: ${original.subject}`.slice(0, AGENT_MESSAGE_SUBJECT_MAX_LENGTH)
      : validateSubject(body.subject);

  // Settle the original first: if it is no longer answerable, the reply must
  // not exist at all.
  const message = transitionAndBroadcast(deps, original, 'answered');

  const reply = agentMessagesDb.create({
    fromSessionId: sessionId,
    toSessionId: original.from_session_id,
    subject,
    body: replyBody,
    replyToMessageId: original.message_id,
  });
  deps.broadcast(reply, 'created');

  return { message, reply };
}

/**
 * Composition root for the handoff inbox service.
 *
 * Session liveness and the WebSocket fan-out are injected so the whole service
 * is testable against a real database without a socket or a live session.
 */
export function createAgentMessagesService(deps: AgentMessagesServiceDeps): AgentMessagesService {
  return {
    send: (fromSessionId, body) => send(deps, fromSessionId, body),
    list: (sessionId, filter) => list(sessionId, filter),
    pullInbox: (sessionId, filter) => pullInbox(deps, sessionId, filter),
    acknowledge: (sessionId, rawMessageId) =>
      transitionAndBroadcast(
        deps,
        requireRecipient(sessionId, validateMessageId(rawMessageId)),
        'acknowledged',
      ),
    answer: (sessionId, rawMessageId, body) => answer(deps, sessionId, rawMessageId, body),
    // Either participant may give up on a handoff: the sender when it stops
    // waiting, the recipient when it cannot do the work.
    fail: (sessionId, rawMessageId, reason) =>
      transitionAndBroadcast(
        deps,
        requireParticipant(sessionId, validateMessageId(rawMessageId)),
        'failed',
        validateDetail(reason),
      ),
  };
}
