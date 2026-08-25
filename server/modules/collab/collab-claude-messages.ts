/**
 * Reading the frames the Claude SDK pushes at a turn's writer.
 *
 * The SDK was written for a websocket: it reports everything — assistant text,
 * failures, permission requests and token accounting — by calling `send` with a
 * normalized message, and older callers send that message as a JSON string. A
 * collaboration turn has no socket, so the adapter next door supplies a plain
 * object instead and has to interpret whatever arrives.
 *
 * That interpretation lives here, apart from the adapter, because it is the one
 * part with no SDK call, no session bookkeeping and no side effects: given a
 * frame, what does it mean? Keeping it pure is what lets the adapter stay a
 * description of how a turn runs.
 */

import type { CollabTurnUsage } from './collab.types.js';

export type WriterMessage = {
  kind?: unknown;
  role?: unknown;
  content?: unknown;
  requestId?: unknown;
  text?: unknown;
  tokenBudget?: unknown;
};

/** The writer receives normalized message objects; older callers send strings. */
export function readWriterMessage(data: unknown): WriterMessage | null {
  try {
    const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data;
    return typeof parsed === 'object' && parsed !== null ? (parsed as WriterMessage) : null;
  } catch {
    return null;
  }
}

/**
 * The SDK announces token accounting as a status frame carrying the running
 * totals for the whole query, so the last one seen is the turn's cost. It is
 * read at all — after having been discarded as transcript noise — because a
 * council enforces a token budget, and a ceiling nobody measures is a wish.
 *
 * A frame that announces accounting but carries none reports `null`: a turn
 * nobody metered must never read as a turn that cost nothing.
 */
export function readUsage(message: WriterMessage): CollabTurnUsage | null {
  if (message.kind !== 'status' || message.text !== 'token_budget') return null;

  const budget = message.tokenBudget as Record<string, unknown> | undefined;
  if (typeof budget !== 'object' || budget === null) return null;

  const inputTokens = Number(budget.inputTokens);
  const outputTokens = Number(budget.outputTokens);
  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return null;

  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  };
}
