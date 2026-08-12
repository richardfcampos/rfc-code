import type { ChatMessage } from '../../types/types';

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readMeasuredDuration(toolUseResult: unknown): number | null {
  if (!toolUseResult || typeof toolUseResult !== 'object') {
    return null;
  }

  const measured = (toolUseResult as { durationMs?: unknown }).durationMs;
  return typeof measured === 'number' && Number.isFinite(measured) && measured >= 0 ? measured : null;
}

/**
 * Wall time of a single tool call, or null when the transcript doesn't carry
 * enough information. The value is always measured — the result timestamp minus
 * the tool_use timestamp, or a duration the tool itself reported. It is never
 * inferred from neighbouring messages, so a missing value stays missing.
 */
export function getToolCallDurationMs(message: ChatMessage): number | null {
  const result = message.toolResult;
  if (!result) {
    return null;
  }

  const start = toEpochMs(message.timestamp);
  const end = toEpochMs(result.timestamp);
  if (start !== null && end !== null && end >= start) {
    return end - start;
  }

  return readMeasuredDuration(result.toolUseResult);
}

/** `0.3s`, `4.4s`, `1m 12s`. */
export function formatToolDuration(durationMs: number): string {
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Real elapsed wall time of a run of tool calls: the latest result timestamp
 * minus the earliest tool_use timestamp.
 *
 * Never a sum of the individual durations — parallel calls issued in one
 * assistant message share a start timestamp, so summing four overlapping 0.3s
 * reads would report `1.2s` for a batch that took 0.3s. Returns null unless
 * every call in the run carries both ends, because a partial run would present
 * one call's span as the whole card's total.
 */
export function getToolRunElapsedMs(messages: ChatMessage[]): number | null {
  if (messages.length === 0) {
    return null;
  }

  let earliestStart: number | null = null;
  let latestEnd: number | null = null;

  for (const message of messages) {
    const start = toEpochMs(message.timestamp);
    const end = toEpochMs(message.toolResult?.timestamp);
    if (start === null || end === null) {
      return null;
    }

    if (earliestStart === null || start < earliestStart) earliestStart = start;
    if (latestEnd === null || end > latestEnd) latestEnd = end;
  }

  if (earliestStart === null || latestEnd === null || latestEnd < earliestStart) {
    return null;
  }

  return latestEnd - earliestStart;
}
