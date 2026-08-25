/**
 * The credential an inbound webhook presents.
 *
 * The plaintext secret is generated here, returned to the caller exactly once
 * and never stored: only its SHA-256 digest goes into `trigger_config`, so a
 * dump of the database (or of a log line carrying a rule) hands nobody the
 * ability to fire an automation. Verification hashes the presented value and
 * compares digests with `timingSafeEqual`, which keeps the comparison's
 * duration independent of how much of the secret a prober guessed right.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes of entropy, url-safe so it survives being pasted into a header. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Constant-time check of a presented secret against a stored digest.
 *
 * A missing or malformed digest is a refusal, never a pass: a rule whose config
 * lost its `secretHash` must not become an open endpoint.
 */
export function verifyWebhookSecret(presented: unknown, storedHash: unknown): boolean {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;

  const expected = Buffer.from(storedHash, 'hex');
  // A digest that is not 32 bytes of hex was never produced by
  // `hashWebhookSecret`; comparing against it would throw on length mismatch.
  if (expected.length !== 32) return false;

  return timingSafeEqual(Buffer.from(hashWebhookSecret(presented), 'hex'), expected);
}

/** Reads the secret from the header the sender sets, falling back to a bearer token. */
export function readWebhookSecret(headers: Record<string, unknown>): string | null {
  const direct = headers['x-automation-secret'];
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  const authorization = headers.authorization;
  if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice('bearer '.length).trim();
    return token.length > 0 ? token : null;
  }

  return null;
}
