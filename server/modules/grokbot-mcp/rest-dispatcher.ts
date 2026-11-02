/**
 * Loopback HTTP client every REST-backed tool goes through. Tools call the
 * server's own routes (not the services behind them) so middleware, validation,
 * org policies, broadcasts and logs behave exactly as for the UI. This client
 * authenticates as the acting user, unwraps `{ success, data }`, folds the
 * routes' error shapes into one `RestError` and turns bytes / SSE into values.
 */
import type { RestDispatcher, RestRequest } from './grokbot-mcp.types.js';
import { isObject, parseText, readBytes, readSse, RestError, toRestError } from './rest-dispatcher-body.js';

export { RestError } from './rest-dispatcher-body.js';

export type RestDispatcherDeps = {
  /** Resolved per call because the server may not be listening yet when this is built. */
  resolveBaseUrl(): string;
  mintToken(): string;
  /** Entries with an `undefined` value are dropped, so callers can pass optional env vars as-is. */
  extraHeaders?: () => Record<string, string | undefined>;
  defaultTimeoutMs?: number;
  maxBytes?: number;
  /** SSE reads stop (and report `truncated`) past this many events. */
  maxSseEvents?: number;
  /** SSE reads stop (and report `truncated`) when an unterminated frame grows past this. */
  maxSseBufferBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_SSE_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_SSE_EVENTS = 5000;
const DEFAULT_MAX_SSE_BUFFER_BYTES = 1024 * 1024;
const ACCEPT = { json: 'application/json', bytes: '*/*', sse: 'text/event-stream' } as const;

function buildUrl(baseUrl: string, path: string, query: RestRequest['query']): string {
  const pairs = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  if (pairs.length === 0) return baseUrl + path;
  return `${baseUrl}${path}${path.includes('?') ? '&' : '?'}${pairs.join('&')}`;
}

function buildBody(request: RestRequest, headers: Record<string, string>): FormData | string | undefined {
  if (request.multipart) {
    // fetch derives the multipart boundary itself; setting Content-Type by hand would drop it.
    const form = new FormData();
    for (const [name, value] of Object.entries(request.multipart.fields ?? {})) form.append(name, value);
    for (const file of request.multipart.files) {
      const blob = new Blob([Buffer.from(file.contentBase64, 'base64')], {
        type: file.mimeType ?? 'application/octet-stream',
      });
      form.append(file.field, blob, file.fileName);
    }
    return form;
  }
  if (request.body === undefined) return undefined;
  headers['Content-Type'] = 'application/json';
  return JSON.stringify(request.body);
}

/** Folds envelope, RAW and legacy git responses into either a value or a thrown RestError. */
function normaliseJson(status: number, statusText: string, body: unknown): unknown {
  if (status >= 400) throw toRestError(status, body, statusText);
  if (!isObject(body)) return body;
  const keys = Object.keys(body);
  if (body.success === false) {
    const errorStatus = typeof body.statusCode === 'number' ? body.statusCode : 400;
    throw toRestError(errorStatus, body, statusText);
  }
  if (body.success === true && 'data' in body && keys.length === 2) return body.data;
  if (keys.length === 1 && keys[0] === 'error') {
    const legacy = toRestError(400, body, statusText);
    throw new RestError(400, 'LEGACY_ERROR', legacy.message, legacy.details);
  }
  return body;
}

function toTransportError(error: unknown): RestError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError') return new RestError(504, 'LOOPBACK_TIMEOUT', 'Loopback request timed out');
  const cause = error instanceof Error && isObject(error.cause) ? error.cause : undefined;
  const detail = typeof cause?.code === 'string' ? cause.code : error instanceof Error ? error.message : String(error);
  return new RestError(503, 'LOOPBACK_UNREACHABLE', `Loopback server unreachable (${detail})`);
}

export function createRestDispatcher(deps: RestDispatcherDeps): RestDispatcher {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const sseLimits = {
    maxEvents: deps.maxSseEvents ?? DEFAULT_MAX_SSE_EVENTS,
    maxBufferBytes: deps.maxSseBufferBytes ?? DEFAULT_MAX_SSE_BUFFER_BYTES,
  };
  async function dispatch(request: RestRequest): Promise<unknown> {
    const responseType = request.responseType ?? 'json';
    const extra = Object.entries(deps.extraHeaders?.() ?? {}).filter(([, value]) => value !== undefined);
    const headers: Record<string, string> = {
      ...(Object.fromEntries(extra) as Record<string, string>),
      Authorization: `Bearer ${deps.mintToken()}`,
      Accept: ACCEPT[responseType],
    };
    const body = buildBody(request, headers);
    const timeoutMs =
      request.timeoutMs ?? (responseType === 'sse' ? DEFAULT_SSE_TIMEOUT_MS : (deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS));
    const stopper = new AbortController();
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), stopper.signal]);
    const url = buildUrl(deps.resolveBaseUrl(), request.path, request.query);

    try {
      // Redirects are never followed: fetch would replay the custom auth headers to whatever host the
      // Location names, and no loopback route the tools call is supposed to redirect.
      const response = await fetch(url, { method: request.method, headers, body, signal, redirect: 'manual' });
      const stop = () => stopper.abort();
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get('location');
        throw new RestError(response.status, 'UNEXPECTED_REDIRECT', `Loopback route answered ${response.status}${location ? ` -> ${location}` : ''}`);
      }
      if (responseType === 'bytes') return await readBytes(response, maxBytes, stop);
      if (responseType === 'sse') return await readSse(response, request, stop, sseLimits);
      return normaliseJson(response.status, response.statusText, parseText(await response.text()));
    } catch (error) {
      if (error instanceof RestError) throw error;
      throw toTransportError(error);
    }
  }

  return { dispatch };
}
