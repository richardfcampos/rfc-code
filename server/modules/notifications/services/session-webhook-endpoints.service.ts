/**
 * Configuration of session webhook endpoints: an external agent registers a
 * URL (plus a shared secret and filters) under the `session_webhook` channel
 * of the generic notification endpoints table, and gets a signed POST when a
 * session stops, fails or waits on an approval.
 *
 * The secret lives in `metadata_json` next to the URL and never leaves the
 * server: every read path masks it through `maskSessionWebhookMetadata`.
 */

export const SESSION_WEBHOOK_CHANNEL = 'session_webhook';

export const SESSION_WEBHOOK_EVENTS = ['session.idle', 'session.error', 'session.waiting_approval'] as const;
export type SessionWebhookEvent = (typeof SESSION_WEBHOOK_EVENTS)[number];

export type SessionWebhookMetadata = {
  url: string;
  secret: string;
  events: SessionWebhookEvent[];
  /** Project ids or absolute paths; empty = every project. */
  projects: string[];
  /** Session ids; empty = every session. */
  sessions: string[];
};

export class SessionWebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionWebhookConfigError';
  }
}

const MAX_SECRET_LENGTH = 512;
/** A signature plus its body is enough for an offline guess of a short key. */
const MIN_SECRET_LENGTH = 16;
/** Shorter secrets get no hint at all: four characters would be a quarter of the key. */
const MIN_SECRET_LENGTH_FOR_HINT = 12;

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new SessionWebhookConfigError(`${name} must be an array of strings.`);
  }
  return Array.from(new Set((value as string[]).map((entry) => entry.trim()).filter(Boolean)));
}

function readUrl(value: unknown): string {
  const url = readText(value);
  if (!url) throw new SessionWebhookConfigError('url is required.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SessionWebhookConfigError('url must be a valid http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SessionWebhookConfigError('url must use http or https.');
  }
  return url;
}

function readEvents(value: unknown): SessionWebhookEvent[] {
  const list = readStringList(value, 'events');
  if (list.length === 0) return [...SESSION_WEBHOOK_EVENTS];
  for (const event of list) {
    if (!(SESSION_WEBHOOK_EVENTS as readonly string[]).includes(event)) {
      throw new SessionWebhookConfigError(`events must be a subset of: ${SESSION_WEBHOOK_EVENTS.join(', ')}.`);
    }
  }
  return list as SessionWebhookEvent[];
}

/**
 * Validates the metadata of an upsert. `existing` is the stored metadata of
 * the endpoint being updated (null on create): a secret omitted on update is
 * carried over, so a filter change never has to re-send the secret.
 */
export function normalizeSessionWebhookUpsert(
  input: Record<string, unknown> | null | undefined,
  existing: Record<string, unknown> | null | undefined,
): SessionWebhookMetadata {
  const source = input && typeof input === 'object' ? input : {};
  const url = readUrl(source.url ?? existing?.url);
  const providedSecret = readText(source.secret);
  if (providedSecret && providedSecret.length < MIN_SECRET_LENGTH) {
    throw new SessionWebhookConfigError(`secret must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
  const secret = providedSecret || readText(existing?.secret);
  if (!secret) throw new SessionWebhookConfigError('secret is required when creating a session webhook endpoint.');
  if (secret.length > MAX_SECRET_LENGTH) throw new SessionWebhookConfigError(`secret must be at most ${MAX_SECRET_LENGTH} characters.`);

  return {
    url,
    secret,
    events: readEvents(source.events ?? existing?.events),
    projects: readStringList(source.projects ?? existing?.projects, 'projects'),
    sessions: readStringList(source.sessions ?? existing?.sessions, 'sessions'),
  };
}

/** Reads stored metadata leniently; a row written by an older version still yields a usable shape. */
export function readSessionWebhookMetadata(metadata: Record<string, unknown> | null | undefined): SessionWebhookMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const url = readText(metadata.url);
  const secret = readText(metadata.secret);
  if (!url || !secret) return null;
  const events = Array.isArray(metadata.events)
    ? (metadata.events.filter((e): e is SessionWebhookEvent => (SESSION_WEBHOOK_EVENTS as readonly string[]).includes(e as string)))
    : [];
  return {
    url,
    secret,
    events: events.length > 0 ? events : [...SESSION_WEBHOOK_EVENTS],
    projects: Array.isArray(metadata.projects) ? metadata.projects.filter((p): p is string => typeof p === 'string') : [],
    sessions: Array.isArray(metadata.sessions) ? metadata.sessions.filter((s): s is string => typeof s === 'string') : [],
  };
}

/** The shape every read path returns: the secret becomes `hasSecret` + its last four characters. */
export function maskSessionWebhookMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  const { secret, ...rest } = source;
  const text = readText(secret);
  return { ...rest, hasSecret: text.length > 0, secretLast4: text.length >= MIN_SECRET_LENGTH_FOR_HINT ? text.slice(-4) : null };
}

export type SessionWebhookMatchInput = {
  event: string;
  projectId: string | null;
  projectPath: string | null;
  sessionId: string | null;
};

/** Whether an endpoint wants this transition. Empty filter lists mean "everything". */
export function matchesTransition(metadata: SessionWebhookMetadata, input: SessionWebhookMatchInput): boolean {
  if (!(metadata.events as readonly string[]).includes(input.event)) return false;
  if (metadata.projects.length > 0) {
    const wanted = metadata.projects;
    const hit = (input.projectId && wanted.includes(input.projectId)) || (input.projectPath && wanted.includes(input.projectPath));
    if (!hit) return false;
  }
  if (metadata.sessions.length > 0) {
    if (!input.sessionId || !metadata.sessions.includes(input.sessionId)) return false;
  }
  return true;
}
