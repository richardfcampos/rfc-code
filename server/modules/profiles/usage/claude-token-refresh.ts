/**
 * OAuth token refresh for Claude profiles.
 *
 * Access tokens expire within hours, so any profile that has not run a session
 * recently holds a stale token even though its refresh token is fine — exactly
 * the idle-account case this multi-account app exists for. The CLI refreshes
 * on next use; for the usage meter we do the same dance ourselves and persist
 * the rotated pair back to `.credentials.json` so the CLI benefits too.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { FetchLike } from './profile-usage.types.js';

// Claude Code's public OAuth client id (the same one the CLI ships with).
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
// Anthropic moved the token endpoint to platform.claude.com; the old console
// host still answers for older tokens, so it stays as a fallback.
const TOKEN_URLS = [
  'https://platform.claude.com/v1/oauth/token',
  'https://console.anthropic.com/v1/oauth/token',
];
const REQUEST_TIMEOUT_MS = 10_000;

export interface RefreshedCredentials {
  accessToken: string;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

/**
 * Refreshes the profile's OAuth pair and rewrites `.credentials.json`.
 * Returns null when the refresh is rejected (revoked/invalid grant) or the
 * endpoints are unreachable — callers treat both as "cannot show usage now".
 */
export async function refreshClaudeCredentials(
  profileDir: string,
  options: { fetchImpl?: FetchLike; now?: () => Date } = {},
): Promise<RefreshedCredentials | null> {
  const fetchImpl = (options.fetchImpl ?? fetch) as FetchLike;
  const now = options.now ?? (() => new Date());
  const credentialPath = path.join(profileDir, '.credentials.json');

  let parsed: { claudeAiOauth?: Record<string, unknown> };
  try {
    parsed = JSON.parse(fs.readFileSync(credentialPath, 'utf8')) as typeof parsed;
  } catch {
    return null;
  }
  const oauth = parsed.claudeAiOauth;
  const refreshToken = oauth && typeof oauth.refreshToken === 'string' ? oauth.refreshToken : '';
  if (!refreshToken) {
    return null;
  }

  for (const url of TOKEN_URLS) {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: CLIENT_ID,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      continue;
    }
    if (!response.ok) {
      // 404 → wrong host for this token generation, try the next one; other
      // rejections (400/401 invalid grant) will repeat on the fallback anyway.
      continue;
    }

    let payload: TokenResponse;
    try {
      payload = (await response.json()) as TokenResponse;
    } catch {
      continue;
    }
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
      continue;
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
    const updatedOauth: Record<string, unknown> = {
      ...oauth,
      accessToken: payload.access_token,
      expiresAt: now().getTime() + expiresIn * 1000,
    };
    if (typeof payload.refresh_token === 'string' && payload.refresh_token) {
      updatedOauth.refreshToken = payload.refresh_token;
    }

    try {
      // Atomic replace so a concurrent CLI read never sees a half-written file.
      const tmpPath = `${credentialPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify({ ...parsed, claudeAiOauth: updatedOauth }), {
        mode: 0o600,
      });
      fs.renameSync(tmpPath, credentialPath);
    } catch {
      // Persisting failed (read-only fs?) — still usable for this request.
    }
    return { accessToken: payload.access_token };
  }

  return null;
}
