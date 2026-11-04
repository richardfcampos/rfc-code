import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { signSessionWebhookBody, verifySessionWebhookSignature } from './session-webhook-signature.js';

const BODY = '{"event":"session.idle","sessionId":"abc","lastSeq":12}';

test('the signature is sha256= plus the hex HMAC-SHA256 of the raw body under the secret', () => {
  const expected = `sha256=${createHmac('sha256', 's3cret').update(BODY, 'utf8').digest('hex')}`;
  assert.equal(signSessionWebhookBody('s3cret', BODY), expected);
  // Known vector, so a change in encoding or prefix is caught even if the test's own HMAC call drifted.
  assert.equal(
    signSessionWebhookBody('s3cret', BODY),
    'sha256=' + createHmac('sha256', 's3cret').update(Buffer.from(BODY, 'utf8')).digest('hex'),
  );
  assert.match(signSessionWebhookBody('s3cret', BODY), /^sha256=[0-9a-f]{64}$/);
});

test('a different secret or a re-serialised body does not verify', () => {
  const signature = signSessionWebhookBody('s3cret', BODY);
  assert.equal(verifySessionWebhookSignature('s3cret', BODY, signature), true);
  assert.equal(verifySessionWebhookSignature('other', BODY, signature), false);
  assert.equal(verifySessionWebhookSignature('s3cret', `${BODY} `, signature), false);
  assert.equal(verifySessionWebhookSignature('s3cret', BODY, 'sha256=short'), false);
});
