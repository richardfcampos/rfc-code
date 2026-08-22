/**
 * Named failures of the Agent Bridge.
 *
 * All extend the shared `AppError`, so the global REST error middleware maps
 * them to a status and a `{ success: false, error: { code, message } }` body
 * without any route-level branching. The stdio MCP process turns that same
 * body into a JSON-RPC error the agent can read.
 */

import { AppError } from '@/shared/utils.js';

/** Missing, malformed or forged bridge token. */
export class AgentBridgeAuthError extends AppError {
  constructor(message = 'Invalid agent bridge token.') {
    super(message, { code: 'AGENT_BRIDGE_UNAUTHORIZED', statusCode: 401 });
    this.name = 'AgentBridgeAuthError';
  }
}

/**
 * The token is genuine but its session no longer exists.
 *
 * Distinct from a bad token on purpose: the agent process cannot fix this by
 * re-reading its config, and 410 tells it the scope itself is gone.
 */
export class AgentBridgeSessionGoneError extends AppError {
  constructor(sessionId: string) {
    super(`Session "${sessionId}" no longer exists; this bridge token is dead.`, {
      code: 'AGENT_BRIDGE_SESSION_GONE',
      statusCode: 410,
    });
    this.name = 'AgentBridgeSessionGoneError';
  }
}

export class AgentBridgeUnknownToolError extends AppError {
  constructor(toolName: string) {
    super(`Unknown agent bridge tool "${toolName}".`, {
      code: 'AGENT_BRIDGE_UNKNOWN_TOOL',
      statusCode: 404,
    });
    this.name = 'AgentBridgeUnknownToolError';
  }
}

export class AgentBridgeValidationError extends AppError {
  constructor(message: string) {
    super(message, { code: 'AGENT_BRIDGE_VALIDATION_ERROR', statusCode: 400 });
    this.name = 'AgentBridgeValidationError';
  }
}

/**
 * The task exists somewhere, but not in the project this token is scoped to.
 *
 * Answers 404 rather than 403 so a token cannot be used to probe which task
 * ids exist in other projects.
 */
export class AgentBridgeTaskNotFoundError extends AppError {
  constructor(taskId: string) {
    super(`Task "${taskId}" was not found on this project's board.`, {
      code: 'AGENT_BRIDGE_TASK_NOT_FOUND',
      statusCode: 404,
    });
    this.name = 'AgentBridgeTaskNotFoundError';
  }
}
