import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveAgentBridgeSecret,
  readBearerToken,
  signAgentBridgeToken,
  verifyAgentBridgeToken,
} from '@/modules/agent-bridge/agent-bridge-token.js';

const SECRET = deriveAgentBridgeSecret('installation-root-secret');
const OTHER_SECRET = deriveAgentBridgeSecret('a-different-installation');

const PAYLOAD = {
  sessionId: 'session-1',
  projectPath: '/home/dev/my-app',
  projectName: 'project-1',
};

test('a signed token verifies back to its payload', () => {
  const token = signAgentBridgeToken({ ...PAYLOAD, iat: 1_750_000_000 }, SECRET);
  const verified = verifyAgentBridgeToken(token, SECRET);

  assert.deepEqual(verified, { ...PAYLOAD, iat: 1_750_000_000 });
});

test('iat defaults to now and a null project path survives the round trip', () => {
  const before = Math.floor(Date.now() / 1000);
  const token = signAgentBridgeToken({ ...PAYLOAD, projectPath: null }, SECRET);
  const verified = verifyAgentBridgeToken(token, SECRET);

  assert.ok(verified);
  assert.equal(verified.projectPath, null);
  assert.ok(verified.iat >= before);
});

test('signing refuses an empty session or project', () => {
  assert.throws(() => signAgentBridgeToken({ ...PAYLOAD, sessionId: '   ' }, SECRET));
  assert.throws(() => signAgentBridgeToken({ ...PAYLOAD, projectName: '' }, SECRET));
});

test('a tampered payload does not verify', () => {
  const token = signAgentBridgeToken(PAYLOAD, SECRET);
  const [version, , signature] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({ ...PAYLOAD, projectName: 'someone-elses-project', iat: 1 }),
    'utf8',
  ).toString('base64url');

  assert.equal(verifyAgentBridgeToken(`${version}.${forged}.${signature}`, SECRET), null);
});

test('a tampered signature does not verify', () => {
  const token = signAgentBridgeToken(PAYLOAD, SECRET);
  const [version, payload, signature] = token.split('.') as [string, string, string];
  const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;

  assert.equal(verifyAgentBridgeToken(`${version}.${payload}.${flipped}`, SECRET), null);
  // A truncated signature must fail on length, not throw.
  assert.equal(verifyAgentBridgeToken(`${version}.${payload}.${signature.slice(0, 8)}`, SECRET), null);
});

test('a token from another installation does not verify', () => {
  const token = signAgentBridgeToken(PAYLOAD, OTHER_SECRET);

  assert.equal(verifyAgentBridgeToken(token, SECRET), null);
});

test('the derived secret is not the root secret and is stable', () => {
  const derived = deriveAgentBridgeSecret('installation-root-secret');

  assert.deepEqual(derived, SECRET);
  assert.notEqual(derived.toString('hex'), Buffer.from('installation-root-secret').toString('hex'));
  assert.throws(() => deriveAgentBridgeSecret(''));
});

test('malformed tokens verify to null instead of throwing', () => {
  for (const candidate of ['', 'not-a-token', 'v1.only-two', 'v2.abc.def', undefined, null, 42, {}]) {
    assert.equal(verifyAgentBridgeToken(candidate, SECRET), null);
  }

  const validPayload = Buffer.from(JSON.stringify({ sessionId: 'session-1' }), 'utf8').toString('base64url');
  const signed = signAgentBridgeToken(PAYLOAD, SECRET).split('.')[2];
  assert.equal(verifyAgentBridgeToken(`v1.${validPayload}.${signed}`, SECRET), null);
});

test('readBearerToken accepts only a Bearer header', () => {
  assert.equal(readBearerToken('Bearer abc123'), 'abc123');
  assert.equal(readBearerToken('bearer   abc123  '), 'abc123');
  assert.equal(readBearerToken('Basic abc123'), null);
  assert.equal(readBearerToken('Bearer '), null);
  assert.equal(readBearerToken(undefined), null);
});
