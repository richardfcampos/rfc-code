/**
 * Normalized plan-usage contract shared by every provider fetcher.
 *
 * Providers expose wildly different views of "how much of my plan did I burn"
 * (Claude: an OAuth usage endpoint; Codex: rate-limit events inside session
 * rollouts). Normalizing here keeps the route and the frontend free of
 * per-provider branching — the same reason provider capabilities are
 * backend-owned.
 */

/** One rolling rate-limit window (e.g. the 5-hour session cap). */
export interface ProfileUsageWindow {
  /** Provider-native window id, e.g. `five_hour`, `seven_day`, `primary`. */
  id: string;
  /** Short human label, e.g. `5h`, `7d`, `7d Opus`. */
  label: string;
  /** Percentage of the window already consumed, clamped to 0–100. */
  utilization: number;
  /** ISO timestamp when the window resets, when the provider reports one. */
  resetsAt: string | null;
}

export type ProfileUsageStatus = 'ok' | 'unauthenticated' | 'unavailable';

/** Narrower cause for `status: 'unavailable'`, used to drive retry/backoff decisions. */
export type ProfileUsageUnavailableReason = 'rate_limited' | 'network' | 'server' | 'unknown';

export interface ProfileUsageSnapshot {
  /** False when the provider has no known plan-usage source (cursor, opencode). */
  supported: boolean;
  status: ProfileUsageStatus;
  windows: ProfileUsageWindow[];
  /** Plan/subscription name when the source reports one (e.g. `max`). */
  plan: string | null;
  /**
   * When the numbers were true. For Claude this equals `fetchedAt`; for Codex
   * it is the timestamp of the last recorded session event, which can be
   * arbitrarily stale — the UI should surface that.
   */
  asOf: string | null;
  fetchedAt: string;
  /** Set only when `status === 'unavailable'`; unset otherwise. */
  reason?: ProfileUsageUnavailableReason;
  /**
   * Milliseconds until the source itself expects to allow another request.
   * Derived from the raw `Retry-After` header, which never leaves the fetcher.
   */
  retryAfterMs?: number;
}

/** Injectable fetch so tests can exercise HTTP paths without global mocks. */
export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  /** Optional so existing mocks without header support keep typechecking. */
  headers?: { get(name: string): string | null };
}>;

/** Public shape returned by the batch route and the `profile_usage` WS event. */
export interface ProfileUsageEnvelope {
  profileId: string;
  state: 'cached' | 'pending';
  snapshot: ProfileUsageSnapshot | null;
  /** ISO timestamp, derived from `retryAfterMs` at response time. */
  retryAt?: string;
}

export const clampUtilization = (value: number): number => Math.min(100, Math.max(0, value));
