/**
 * One delivery: a signed POST of a serialized payload to one endpoint, with a
 * bounded number of attempts and a row per attempt in the delivery log. The
 * log never carries the payload or the secret — a transport error text at
 * most — and nothing in here is allowed to throw at the caller.
 */

import { sessionWebhookDeliveriesDb } from '@/modules/database/index.js';

import { SESSION_WEBHOOK_SIGNATURE_HEADER, signSessionWebhookBody } from './session-webhook-signature.js';

export const SESSION_WEBHOOK_TIMEOUT_MS = 5_000;
export const SESSION_WEBHOOK_MAX_ATTEMPTS = 3;
/** Wait before attempt n+1; the last entry is only reached when the attempt cap grows. */
export const SESSION_WEBHOOK_BACKOFF_MS = [1_000, 4_000, 16_000] as const;

export type SessionWebhookDeliveryTarget = {
  endpointId: string;
  userId: number | null;
  url: string;
  secret: string;
};

export type SessionWebhookDeliveryOutcome = {
  ok: boolean;
  deliveryId: string;
  attempts: number;
  lastStatus: number | null;
  error: string | null;
};

export type SessionWebhookTransport = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

export const defaultSessionWebhookTransport: SessionWebhookTransport = {
  fetch: (...args) => fetch(...args),
  sleep: defaultSleep,
};

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name === 'AbortError' ? `timeout after ${SESSION_WEBHOOK_TIMEOUT_MS}ms` : error.message;
  return String(error);
}

async function postOnce(
  target: SessionWebhookDeliveryTarget,
  rawBody: string,
  headers: Record<string, string>,
  transport: SessionWebhookTransport,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SESSION_WEBHOOK_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await transport.fetch(target.url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
      // A redirect would re-send the signed body to a host nobody configured.
      redirect: 'manual',
    });
    // The body is irrelevant; releasing it returns the socket to the pool.
    await response.body?.cancel().catch(() => undefined);
    const ok = response.status >= 200 && response.status < 300;
    return { ok, status: response.status, error: ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, status: null, error: describeError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function recordAttempt(
  target: SessionWebhookDeliveryTarget,
  input: { deliveryId: string; event: string; sessionId: string | null; attempt: number },
  result: { ok: boolean; status: number | null; error: string | null },
): void {
  try {
    sessionWebhookDeliveriesDb.record({
      deliveryId: input.deliveryId,
      endpointId: target.endpointId,
      userId: target.userId,
      event: input.event,
      sessionId: input.sessionId,
      attempt: input.attempt,
      ok: result.ok,
      httpStatus: result.status,
      error: result.error,
    });
  } catch (error) {
    console.error('[session-webhook] could not record a delivery attempt:', error);
  }
}

/** Posts `rawBody` (already serialized and therefore signable as-is) with retries. Never rejects. */
export async function deliverSessionWebhook(input: {
  target: SessionWebhookDeliveryTarget;
  deliveryId: string;
  event: string;
  sessionId: string | null;
  rawBody: string;
  transport?: SessionWebhookTransport;
}): Promise<SessionWebhookDeliveryOutcome> {
  const transport = input.transport ?? defaultSessionWebhookTransport;
  const headers = {
    'Content-Type': 'application/json',
    'X-RFC-Event': input.event,
    'X-RFC-Delivery': input.deliveryId,
    [SESSION_WEBHOOK_SIGNATURE_HEADER]: signSessionWebhookBody(input.target.secret, input.rawBody),
  };

  let last: { ok: boolean; status: number | null; error: string | null } = { ok: false, status: null, error: 'not attempted' };
  let attempts = 0;
  for (let attempt = 1; attempt <= SESSION_WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await transport.sleep(SESSION_WEBHOOK_BACKOFF_MS[Math.min(attempt - 2, SESSION_WEBHOOK_BACKOFF_MS.length - 1)]);
    }
    attempts = attempt;
    last = await postOnce(input.target, input.rawBody, headers, transport);
    recordAttempt(input.target, { deliveryId: input.deliveryId, event: input.event, sessionId: input.sessionId, attempt }, last);
    if (last.ok) break;
  }

  return { ok: last.ok, deliveryId: input.deliveryId, attempts, lastStatus: last.status, error: last.ok ? null : last.error };
}
