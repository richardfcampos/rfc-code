/**
 * Plan-usage fetcher for Claude profiles.
 *
 * Reads the profile's OAuth access token from `<profileDir>/.credentials.json`
 * and queries Anthropic's OAuth usage endpoint — the same source the CLI's
 * `/usage` screen uses. Requires the `user:profile` scope; tokens minted with
 * only `user:inference` get 401/403, which we surface as `unauthenticated`
 * (the fix is a re-login, same as a missing credential file).
 */

import fs from 'node:fs';
import path from 'node:path';

import { refreshClaudeCredentials } from './claude-token-refresh.js';
import {
  clampUtilization,
  type FetchLike,
  type ProfileUsageSnapshot,
  type ProfileUsageWindow,
} from './profile-usage.types.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// Without a claude-code User-Agent the endpoint answers from an aggressively
// rate-limited bucket and 429s persistently (anthropics/claude-code#31021).
const USER_AGENT = 'claude-code/1.0.0';
const REQUEST_TIMEOUT_MS = 10_000;

/** Known window keys mapped to short labels; unknown keys keep their id. */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_sonnet: '7d Sonnet',
  seven_day_opus: '7d Opus',
};

interface ClaudeCredentials {
  accessToken: string;
  expiresAt: number | null;
}

/** Maps an HTTP failure status to the reason surfaced on the snapshot. */
function classifyUnavailableReason(status: number): ProfileUsageSnapshot['reason'] {
  if (status === 429) {
    return 'rate_limited';
  }
  if (status >= 500) {
    return 'server';
  }
  return 'unknown';
}

/**
 * Parses `Retry-After` into milliseconds. The header is either a delay in
 * seconds or an HTTP-date; either way only the derived number leaves this
 * module, never the raw header value.
 */
function parseRetryAfterMs(headerValue: string | null | undefined, now: Date): number | undefined {
  if (!headerValue) {
    return undefined;
  }
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
  }
  const parsedDate = Date.parse(trimmed);
  if (Number.isNaN(parsedDate)) {
    return undefined;
  }
  return Math.max(0, parsedDate - now.getTime());
}

function readCredentials(profileDir: string): ClaudeCredentials | null {
  try {
    const raw = fs.readFileSync(path.join(profileDir, '.credentials.json'), 'utf8');
    const parsed = JSON.parse(raw) as { claudeAiOauth?: Record<string, unknown> };
    const oauth = parsed.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
      return null;
    }
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
    };
  } catch {
    return null;
  }
}

function parseWindows(payload: Record<string, unknown>): ProfileUsageWindow[] {
  const windows: ProfileUsageWindow[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    if (typeof entry.utilization !== 'number' || !Number.isFinite(entry.utilization)) {
      continue;
    }
    windows.push({
      id: key,
      label: WINDOW_LABELS[key] ?? key,
      utilization: clampUtilization(entry.utilization),
      resetsAt: typeof entry.resets_at === 'string' ? entry.resets_at : null,
    });
  }
  // Stable, meaningful order: known windows first in declaration order.
  const rank = (id: string) => {
    const index = Object.keys(WINDOW_LABELS).indexOf(id);
    return index === -1 ? Object.keys(WINDOW_LABELS).length : index;
  };
  return windows.sort((a, b) => rank(a.id) - rank(b.id));
}

function parsePlan(payload: Record<string, unknown>): string | null {
  if (typeof payload.subscriptionType === 'string' && payload.subscriptionType) {
    return payload.subscriptionType;
  }
  if (typeof payload.rate_limit_tier === 'string' && payload.rate_limit_tier) {
    return payload.rate_limit_tier;
  }
  return null;
}

export async function fetchClaudeUsage(
  profileDir: string,
  options: { fetchImpl?: FetchLike; now?: () => Date } = {},
): Promise<ProfileUsageSnapshot> {
  const now = options.now ?? (() => new Date());
  const fetchImpl = (options.fetchImpl ?? fetch) as FetchLike;
  const fetchedAt = now().toISOString();

  const base: Omit<ProfileUsageSnapshot, 'status'> = {
    supported: true,
    windows: [],
    plan: null,
    asOf: null,
    fetchedAt,
  };

  const credentials = readCredentials(profileDir);
  if (!credentials) {
    return { ...base, status: 'unauthenticated' };
  }

  // An expired access token is normal for a profile that has not run a session
  // recently — refresh it like the CLI would instead of demanding a re-login.
  let accessToken = credentials.accessToken;
  let refreshed = false;
  if (credentials.expiresAt !== null && credentials.expiresAt <= now().getTime()) {
    const renewed = await refreshClaudeCredentials(profileDir, options);
    if (!renewed) {
      return { ...base, status: 'unauthenticated' };
    }
    accessToken = renewed.accessToken;
    refreshed = true;
  }

  const requestUsage = (token: string) =>
    fetchImpl(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  try {
    let response = await requestUsage(accessToken);

    // A token can be rejected before its recorded expiry (revocation, clock
    // skew). One refresh-and-retry covers the skew case.
    if ((response.status === 401 || response.status === 403) && !refreshed) {
      const renewed = await refreshClaudeCredentials(profileDir, options);
      if (!renewed) {
        return { ...base, status: 'unauthenticated' };
      }
      response = await requestUsage(renewed.accessToken);
    }

    if (response.status === 401 || response.status === 403) {
      return { ...base, status: 'unauthenticated' };
    }
    if (!response.ok) {
      const reason = classifyUnavailableReason(response.status);
      const retryAfterMs =
        reason === 'rate_limited'
          ? parseRetryAfterMs(response.headers?.get('retry-after'), now())
          : undefined;
      return { ...base, status: 'unavailable', reason, retryAfterMs };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object') {
      return { ...base, status: 'unavailable' };
    }
    return {
      ...base,
      status: 'ok',
      windows: parseWindows(payload),
      plan: parsePlan(payload),
      asOf: fetchedAt,
    };
  } catch {
    // Network failure or timeout — usage is a nice-to-have, never an error page.
    return { ...base, status: 'unavailable', reason: 'network' };
  }
}
