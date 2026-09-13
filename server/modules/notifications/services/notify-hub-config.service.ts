/**
 * notify-hub configuration service.
 *
 * The webhook channel used to be env-only (NOTIFY_URL/NOTIFY_TOKEN), which meant
 * pointing at a different notify-hub instance required editing env files and
 * restarting. This service reads the same three settings from `app_config`
 * first, falling back to env, so an operator can configure (and hot-swap) the
 * hub from Settings without a restart. Every read hits the DB fresh — no
 * module-level cache — because the config is meant to change while the server
 * is running.
 */

import { appConfigDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

const APP_CONFIG_KEYS = {
  url: 'notify_hub_url',
  token: 'notify_hub_token',
  timezone: 'notify_hub_timezone',
} as const;

const TEST_TIMEOUT_MS = 5_000;

type NotifyHubConfigSource = 'db' | 'env' | 'none';

type NotifyHubConfig = {
  url: string | null;
  token: string | null;
  timezone: string | null;
  source: NotifyHubConfigSource;
};

type NotifyHubPublicView = {
  url: string | null;
  hasToken: boolean;
  tokenHint: string | null;
  timezone: string | null;
  source: NotifyHubConfigSource;
  configured: boolean;
};

type SaveNotifyHubConfigInput = {
  url?: unknown;
  token?: unknown;
  timezone?: unknown;
};

type NotifyHubTestBody = Record<string, unknown>;

type NotifyHubTestResult = {
  ok: boolean;
  status: number | null;
  error?: string;
};

/** Reads one field from `app_config`, falling back to the matching env var. */
function readField(dbKey: string, envValue: string | undefined): { value: string | null; fromDb: boolean } {
  const dbValue = appConfigDb.get(dbKey);
  if (dbValue) {
    return { value: dbValue, fromDb: true };
  }
  return { value: envValue || null, fromDb: false };
}

/**
 * Resolves the effective notify-hub config: `app_config` overrides env,
 * per field. `source` reflects where the credentials (url/token) came from;
 * timezone alone does not change it since url+token are what gate sending.
 */
export function getNotifyHubConfig(): NotifyHubConfig {
  const url = readField(APP_CONFIG_KEYS.url, process.env.NOTIFY_URL);
  const token = readField(APP_CONFIG_KEYS.token, process.env.NOTIFY_TOKEN);
  const timezone = readField(APP_CONFIG_KEYS.timezone, process.env.NOTIFY_TIMEZONE);

  let source: NotifyHubConfigSource = 'none';
  if (url.fromDb || token.fromDb) {
    source = 'db';
  } else if (url.value || token.value) {
    source = 'env';
  }

  return { url: url.value, token: token.value, timezone: timezone.value, source };
}

/** Channel is usable once both endpoint and token resolve to a value. */
export function isNotifyHubConfigured(cfg: NotifyHubConfig): boolean {
  return Boolean(cfg.url && cfg.token);
}

/** Validates a URL is well-formed and http(s) — the only schemes the hub can be reached on. */
function validateUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError('URL inválida', { code: 'NOTIFY_HUB_INVALID_URL', statusCode: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('URL deve usar http ou https', { code: 'NOTIFY_HUB_INVALID_URL', statusCode: 400 });
  }
  return rawUrl;
}

/** Validates an IANA timezone name using the same check `Intl` does at format time. */
function validateTimezone(timezone: string): string {
  try {
    // Intl throws RangeError for an unknown zone name — that is the validation.
    void new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new AppError('Fuso horário inválido', { code: 'NOTIFY_HUB_INVALID_TIMEZONE', statusCode: 400 });
  }
  return timezone;
}

/**
 * Persists new notify-hub settings. An empty/omitted token keeps whatever is
 * already stored (the UI never round-trips the real token, only a masked
 * hint), so a save that only changes the URL must not blank the token out.
 */
export function saveNotifyHubConfig(input: SaveNotifyHubConfigInput): NotifyHubConfig {
  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  if (!rawUrl) {
    throw new AppError('URL é obrigatória', { code: 'NOTIFY_HUB_URL_REQUIRED', statusCode: 400 });
  }
  // Validate every field before the first write: a rejected timezone must not
  // leave a half-applied save with the new URL already live.
  const url = validateUrl(rawUrl);
  const rawToken = typeof input.token === 'string' ? input.token.trim() : '';
  const rawTimezone = typeof input.timezone === 'string' ? input.timezone.trim() : '';
  const timezone = rawTimezone ? validateTimezone(rawTimezone) : '';

  appConfigDb.set(APP_CONFIG_KEYS.url, url);
  if (rawToken) {
    appConfigDb.set(APP_CONFIG_KEYS.token, rawToken);
  }
  appConfigDb.set(APP_CONFIG_KEYS.timezone, timezone);

  return getNotifyHubConfig();
}

/** Builds the Settings-facing view: the raw token never leaves this module. */
export function toNotifyHubPublicView(cfg: NotifyHubConfig): NotifyHubPublicView {
  const hasToken = Boolean(cfg.token);
  return {
    url: cfg.url,
    hasToken,
    tokenHint: hasToken ? `••••${cfg.token!.slice(-4)}` : null,
    timezone: cfg.timezone,
    source: cfg.source,
    configured: isNotifyHubConfigured(cfg),
  };
}

/**
 * Sends a real test push using the resolved config. Mirrors the channel's own
 * transport (bearer token, JSON body, 5s abort) but always resolves — this is
 * a user-triggered UX check, not a session-critical send, so callers get a
 * structured result instead of a thrown error either way.
 */
export async function sendNotifyHubTest(cfg: NotifyHubConfig, body: NotifyHubTestBody): Promise<NotifyHubTestResult> {
  if (!isNotifyHubConfigured(cfg)) {
    return { ok: false, status: null, error: 'notify-hub não configurado' };
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const response = await fetch(cfg.url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, error: 'Token inválido' };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha de rede';
    return { ok: false, status: null, error: message };
  } finally {
    clearTimeout(abortTimer);
  }
}

export type { NotifyHubConfig, NotifyHubPublicView, NotifyHubTestResult };
