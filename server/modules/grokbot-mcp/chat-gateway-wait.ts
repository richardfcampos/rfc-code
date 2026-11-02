/**
 * Blocking variant of a bot turn: resolves once the run's terminal `complete`
 * passes by, or when the caller's deadline elapses (the run keeps going and
 * can still be followed through the event replay).
 */

import type { JsonObject } from './grokbot-mcp.types.js';

/** The slice of a registry run the wait needs. */
type WatchedRun = { status: string; events: unknown[]; lastSeq: number };

export type RunWaitOutcome = {
  completed: boolean;
  text?: string;
  events: JsonObject[];
  eventsTruncated?: boolean;
  lastSeq: number;
  timedOut?: boolean;
};

/**
 * A streamed turn yields one `stream_delta` per token, so the full frame list
 * can be huge; the text already carries the content and older frames remain
 * readable through the event replay from `lastSeq`.
 */
export const MAX_RETURNED_EVENTS = 100;

function tailOf(events: JsonObject[]): Pick<RunWaitOutcome, 'events' | 'eventsTruncated'> {
  if (events.length <= MAX_RETURNED_EVENTS) return { events: events.slice() };
  return { events: events.slice(-MAX_RETURNED_EVENTS), eventsTruncated: true };
}

/**
 * A browser that subscribes to the session mid-run re-attaches the run's
 * stream to its own socket, after which this call's collector sees nothing
 * more. The run's status is therefore also polled, and its buffered events are
 * used when the collector never saw the end.
 */
const STATUS_POLL_MS = 250;

/** Assistant text of the turn; falls back to streamed deltas when no full text frame came through. */
export function extractAssistantText(events: JsonObject[]): string {
  const read = (event: JsonObject): string =>
    typeof event.content === 'string' ? event.content : typeof event.text === 'string' ? event.text : '';
  const texts = events.filter((event) => event.kind === 'text' && event.role === 'assistant').map(read);
  if (texts.length > 0) return texts.filter(Boolean).join('\n\n');
  return events.filter((event) => event.kind === 'stream_delta').map(read).join('');
}

export function waitForRunCompletion(input: {
  run: WatchedRun;
  collected: JsonObject[];
  timeoutMs: number;
  subscribe(listener: (frame: JsonObject) => void): void;
}): Promise<RunWaitOutcome> {
  const { run, collected } = input;
  const finishedEvents = (): JsonObject[] =>
    collected.some((frame) => frame.kind === 'complete') ? collected : (run.events as JsonObject[]).slice();

  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: RunWaitOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(poll);
      resolve(outcome);
    };
    const complete = (): void => {
      const events = finishedEvents();
      settle({ completed: true, text: extractAssistantText(events), lastSeq: run.lastSeq, ...tailOf(events) });
    };

    const deadline = setTimeout(() => {
      settle({ completed: false, timedOut: true, lastSeq: run.lastSeq, ...tailOf(collected) });
    }, input.timeoutMs);
    const poll = setInterval(() => {
      if (run.status === 'completed') complete();
    }, STATUS_POLL_MS);
    // The deadline stays referenced (it is bounded) so a pending wait is never
    // dropped by an otherwise idle loop; the poll alone must not hold it open.
    poll.unref?.();

    input.subscribe((frame) => {
      if (frame.kind === 'complete') complete();
    });
    // The runtime may already have finished before the listener was attached.
    if (collected.some((frame) => frame.kind === 'complete') || run.status === 'completed') complete();
  });
}
