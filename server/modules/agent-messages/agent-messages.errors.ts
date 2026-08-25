/**
 * Named failures of the Agent Messages module: `server/modules/agent-messages`.
 *
 * All extend the shared `AppError`, so the global error middleware maps them to
 * a status and a `{ success: false, error: { code, message } }` body without any
 * route-level branching — and the agent bridge returns the same message text to
 * the calling agent, which is the only explanation it gets.
 */

import type { AgentMessageState } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

export class AgentMessageValidationError extends AppError {
  constructor(message: string) {
    super(message, { code: 'AGENT_MESSAGE_VALIDATION_ERROR', statusCode: 400 });
    this.name = 'AgentMessageValidationError';
  }
}

export class AgentMessageNotFoundError extends AppError {
  constructor(messageId: string) {
    super(`Message "${messageId}" not found`, { code: 'AGENT_MESSAGE_NOT_FOUND', statusCode: 404 });
    this.name = 'AgentMessageNotFoundError';
  }
}

/**
 * The caller is not the participant this operation belongs to (acknowledging a
 * message addressed to someone else, for instance).
 *
 * 404 rather than 403: a session must not be able to probe another session's
 * mailbox for which message ids exist.
 */
export class AgentMessageNotAddressedError extends AppError {
  constructor(messageId: string) {
    super(`Message "${messageId}" not found`, { code: 'AGENT_MESSAGE_NOT_FOUND', statusCode: 404 });
    this.name = 'AgentMessageNotAddressedError';
  }
}

/** The recipient session named by `message_send` does not exist (any more). */
export class AgentMessageRecipientUnknownError extends AppError {
  constructor(sessionId: string) {
    super(`Session "${sessionId}" is not a session that can receive messages`, {
      code: 'AGENT_MESSAGE_RECIPIENT_UNKNOWN',
      statusCode: 404,
    });
    this.name = 'AgentMessageRecipientUnknownError';
  }
}

/**
 * The message is not in a state this transition may start from.
 *
 * 409 because it is a conflict with the message's current state, not a
 * malformed request: retrying the same call unchanged will keep failing, but
 * the input was never wrong.
 */
export class AgentMessageInvalidTransitionError extends AppError {
  constructor(messageId: string, from: AgentMessageState, to: AgentMessageState) {
    super(`Message "${messageId}" cannot move from "${from}" to "${to}"`, {
      code: 'AGENT_MESSAGE_INVALID_TRANSITION',
      statusCode: 409,
      details: { messageId, from, to },
    });
    this.name = 'AgentMessageInvalidTransitionError';
  }
}
