/**
 * Field-level validation for the Agent Messages module.
 *
 * Input reaches this module straight off the wire (an MCP tool call or a REST
 * query string), so every field is checked here before it becomes a row. Same
 * manual style as `tasks.validation.ts` — no schema library in this codebase.
 */

import type { AgentMessageBox, AgentMessageState } from '@/modules/database/index.js';

import { AgentMessageValidationError } from './agent-messages.errors.js';
import { isAgentMessageState } from './agent-messages.state.js';

/** A subject is a one-line summary; anything longer belongs in the body. */
export const AGENT_MESSAGE_SUBJECT_MAX_LENGTH = 200;
/** Handoffs carry real context (a plan, a diff summary), so the body is generous. */
export const AGENT_MESSAGE_BODY_MAX_LENGTH = 20_000;
/** A failure reason is a sentence, not a stack trace. */
export const AGENT_MESSAGE_DETAIL_MAX_LENGTH = 500;

const BOXES: readonly AgentMessageBox[] = ['inbox', 'outbox'];

function requireTrimmedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new AgentMessageValidationError(`${field} is required.`);
  }

  const text = value.trim();
  if (!text) {
    throw new AgentMessageValidationError(`${field} is required.`);
  }
  if (text.length > maxLength) {
    throw new AgentMessageValidationError(`${field} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

export function validateSessionId(value: unknown, field: string): string {
  return requireTrimmedString(value, field, 200);
}

export function validateMessageId(value: unknown): string {
  return requireTrimmedString(value, 'messageId', 200);
}

export function validateSubject(value: unknown): string {
  return requireTrimmedString(value, 'subject', AGENT_MESSAGE_SUBJECT_MAX_LENGTH);
}

export function validateBody(value: unknown): string {
  return requireTrimmedString(value, 'body', AGENT_MESSAGE_BODY_MAX_LENGTH);
}

/** A failure reason is optional; an empty one reads the same as none at all. */
export function validateDetail(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AgentMessageValidationError('reason must be a string.');
  }

  const text = value.trim();
  if (!text) {
    return null;
  }
  return text.slice(0, AGENT_MESSAGE_DETAIL_MAX_LENGTH);
}

export function validateOptionalMessageId(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AgentMessageValidationError(`${field} must be a string.`);
  }

  const text = value.trim();
  return text ? text : null;
}

/** Defaults to the inbox: an agent asking for "my messages" means the ones waiting on it. */
export function validateBox(value: unknown): AgentMessageBox {
  if (value === undefined || value === null || value === '') {
    return 'inbox';
  }
  if (typeof value !== 'string' || !BOXES.includes(value as AgentMessageBox)) {
    throw new AgentMessageValidationError(`box must be one of: ${BOXES.join(', ')}`);
  }
  return value as AgentMessageBox;
}

export function validateOptionalState(value: unknown): AgentMessageState | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (!isAgentMessageState(value)) {
    throw new AgentMessageValidationError(
      'state must be one of: queued, delivered, acknowledged, answered, failed',
    );
  }
  return value;
}
