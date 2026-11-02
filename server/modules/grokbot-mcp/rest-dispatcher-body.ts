/**
 * Response-body readers of the loopback REST client: error folding, a capped
 * byte reader and the SSE collector. Every read is bounded so a huge file or a
 * chatty stream cannot grow the heap for the lifetime of a request.
 */
import type { JsonObject, RestBytesResult, RestRequest, RestSseResult } from './grokbot-mcp.types.js';

export class RestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RestError';
  }
}

export type SseLimits = { maxEvents: number; maxBufferBytes: number };

/** Error bodies are only parsed for a message, so a small cap is plenty. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseText(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function toRestError(status: number, body: unknown, statusText: string): RestError {
  if (!isObject(body)) {
    const message = typeof body === 'string' && body.trim() ? body.slice(0, 500) : statusText;
    return new RestError(status, `HTTP_${status}`, message || `HTTP ${status}`);
  }
  const nested = isObject(body.error) ? body.error : undefined;
  const code = nested?.code ?? body.code;
  const message =
    (typeof nested?.message === 'string' && nested.message) ||
    (typeof body.error === 'string' && body.error) ||
    (typeof body.message === 'string' && body.message) ||
    statusText ||
    `HTTP ${status}`;
  return new RestError(status, typeof code === 'string' ? code : `HTTP_${status}`, message, nested?.details ?? body.details);
}

type CappedBody = { buffer: Buffer; received: number; truncated: boolean };

/** Reads at most `limit` bytes, then cancels the stream so the server stops producing. */
async function readCapped(response: Response, limit: number, stop: () => void): Promise<CappedBody> {
  if (!response.body) return { buffer: Buffer.alloc(0), received: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    received += value.byteLength;
    if (received > limit) {
      stop();
      await reader.cancel().catch(() => undefined);
      return { buffer: Buffer.concat(chunks, received).subarray(0, limit), received, truncated: true };
    }
  }
  return { buffer: Buffer.concat(chunks, received), received, truncated: false };
}

async function throwHttpError(response: Response, stop: () => void): Promise<never> {
  const { buffer } = await readCapped(response, MAX_ERROR_BODY_BYTES, stop);
  throw toRestError(response.status, parseText(buffer.toString('utf8')), response.statusText);
}

export async function readBytes(response: Response, maxBytes: number, stop: () => void): Promise<RestBytesResult> {
  if (response.status >= 400) return throwHttpError(response, stop);
  const { buffer, received, truncated } = await readCapped(response, maxBytes, stop);
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  return {
    contentBase64: buffer.toString('base64'),
    mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
    size: received,
    truncated,
    ...(Number.isFinite(declared) && declared >= 0 ? { contentLength: declared } : {}),
  };
}

function parseSseFrame(frame: string): JsonObject | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return null;
  const name = event || 'message';
  const parsed = parseText(data.join('\n'));
  return isObject(parsed) ? { event: name, ...parsed } : { event: name, data: parsed ?? '' };
}

export async function readSse(
  response: Response,
  request: RestRequest,
  stop: () => void,
  limits: SseLimits,
): Promise<RestSseResult> {
  if (response.status >= 400) return throwHttpError(response, stop);
  const events: JsonObject[] = [];
  if (!response.body) return { events };
  const reader = response.body.getReader();
  // The route keeps the stream open; closing it is what ends the server-side work for us.
  const hangUp = async (truncated: boolean): Promise<RestSseResult> => {
    stop();
    await reader.cancel().catch(() => undefined);
    return truncated ? { events, truncated } : { events };
  };
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (!event) continue;
      if (events.length >= limits.maxEvents) return hangUp(true);
      events.push(event);
      if (request.sseUntil?.(event)) return hangUp(false);
    }
    if (Buffer.byteLength(buffer) > limits.maxBufferBytes) return hangUp(true);
  }
  const tail = parseSseFrame(buffer);
  if (tail) {
    if (events.length >= limits.maxEvents) return { events, truncated: true };
    events.push(tail);
  }
  return { events };
}
