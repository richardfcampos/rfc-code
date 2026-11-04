/**
 * Request signing for session webhooks: HMAC-SHA256 of the exact bytes sent,
 * keyed by the endpoint's shared secret, carried in `X-RFC-Signature` as
 * `sha256=<hex>`. The receiver recomputes it over the raw body it received,
 * so any re-serialisation on either side breaks verification on purpose.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_WEBHOOK_SIGNATURE_HEADER = 'X-RFC-Signature';

export function signSessionWebhookBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

/** Constant-time check a receiver (or a test) can use against a header value. */
export function verifySessionWebhookSignature(secret: string, rawBody: string, signature: string): boolean {
  const expected = Buffer.from(signSessionWebhookBody(secret, rawBody));
  const given = Buffer.from(typeof signature === 'string' ? signature : '');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
