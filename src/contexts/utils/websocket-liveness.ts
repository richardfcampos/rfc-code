/**
 * Pure decision helpers for websocket reconnect backoff and half-open
 * liveness probing. Extracted from WebSocketContext so the timing math is
 * unit-testable without a real WebSocket, timers, or a React tree.
 */

export type BackoffOptions = {
  baseMs: number;
  maxMs: number;
};

export const DEFAULT_BACKOFF_OPTIONS: BackoffOptions = {
  baseMs: 1000,
  maxMs: 15000,
};

/**
 * Exponential backoff delay for reconnect attempt `attempt` (0-indexed,
 * reset to 0 after every successful open): 1s, 2s, 4s, 8s, capped at 15s so
 * a long outage never grows the retry interval unbounded.
 */
export function computeReconnectDelayMs(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF_OPTIONS,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const delay = options.baseMs * 2 ** safeAttempt;
  return Math.min(delay, options.maxMs);
}

/**
 * Whether a liveness probe sent while the socket claimed OPEN has gone
 * unanswered long enough to treat the connection as half-open (TCP still
 * "connected" from the OS's point of view, but the peer is gone — laptop
 * sleep, network switch, a dead reverse-proxy hop).
 *
 * Any activity (the probe's reply or any other frame) observed after the
 * probe was sent counts as proof of life, even if it is not literally the
 * probe's own reply — a message racing in ahead of the reply is just as
 * good a signal that the socket is alive.
 */
export function hasLivenessProbeTimedOut(input: {
  probeSentAt: number;
  lastActivityAt: number | null;
  now: number;
  timeoutMs: number;
}): boolean {
  const { probeSentAt, lastActivityAt, now, timeoutMs } = input;
  if (lastActivityAt !== null && lastActivityAt >= probeSentAt) {
    return false;
  }
  return now - probeSentAt >= timeoutMs;
}

/**
 * Whether a wake event (tab foregrounded, network back online) should force
 * an immediate reconnect rather than waiting on a liveness probe: any
 * `readyState` other than OPEN is already known-dead (CONNECTING that never
 * finished, CLOSING, CLOSED), so there is nothing useful to probe.
 */
export function shouldReconnectImmediatelyOnWake(readyState: number, openState: number): boolean {
  return readyState !== openState;
}
