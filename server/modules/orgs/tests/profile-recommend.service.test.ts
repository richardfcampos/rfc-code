import assert from 'node:assert/strict';
import test from 'node:test';

import { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';
import { recommend } from '@/modules/orgs/services/profile-recommend.service.js';

import {
  captureWarnings,
  createFakeDeps,
  makeOrg,
  makePolicy,
  makeProfile,
  makeRule,
  usageAt,
  usageUnavailable,
  type FakeSetup,
} from './support/fake-org-deps.js';

const PROJECT = '/work/acme/api';

function acmeSetup(overrides: Partial<FakeSetup>): FakeSetup {
  return {
    orgs: [
      makeOrg('org-default', { name: 'Pessoal', isDefault: true }),
      makeOrg('org-acme', { name: 'Acme' }),
    ],
    rules: [makeRule('rule-acme', 'org-acme', 'path_prefix', '/work/acme')],
    ...overrides,
  };
}

const policies = [
  makePolicy('org-acme', 'primary-a', 'primary', 0),
  makePolicy('org-acme', 'primary-b', 'primary', 1),
  makePolicy('org-acme', 'spare', 'fallback', 0),
];

const profiles = [makeProfile('primary-a'), makeProfile('primary-b'), makeProfile('spare')];

test('recommends the first primary under the threshold, with its usage', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies,
      profiles,
      usage: { 'primary-a': usageAt(30), 'primary-b': usageAt(5), spare: usageAt(0) },
    }),
  );

  const result = await recommend(PROJECT, undefined, {}, deps);

  assert.deepEqual(result, {
    profileId: 'primary-a',
    role: 'primary',
    usagePct: 30,
    reason: 'primary profile below the 85% usage threshold',
  });
});

test('skips an exhausted primary for the next one in priority order', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies,
      profiles,
      usage: { 'primary-a': usageAt(96), 'primary-b': usageAt(42), spare: usageAt(0) },
    }),
  );

  const result = await recommend(PROJECT, undefined, {}, deps);

  assert.equal(result.profileId, 'primary-b');
  assert.equal(result.usagePct, 42);
});

test('recommends the fallback once every primary is exhausted, without auditing it', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies,
      profiles,
      usage: { 'primary-a': usageAt(96), 'primary-b': usageAt(88), spare: usageAt(7) },
    }),
  );

  const result = await recommend(PROJECT, undefined, {}, deps);

  assert.equal(result.profileId, 'spare');
  assert.equal(result.role, 'fallback');
  assert.equal(result.usagePct, 7);
  assert.match(result.reason, /at or above the 85% usage threshold/);
  // Advisory call: an audit here would record intentions, not actual runs.
  assert.equal(audits.length, 0);
});

test('keeps the primary when its usage cannot be read', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies,
      profiles,
      usage: { 'primary-a': usageAt(97), 'primary-b': usageUnavailable, spare: usageAt(0) },
    }),
  );

  const result = await recommend(PROJECT, undefined, {}, deps);

  assert.deepEqual(result, {
    profileId: 'primary-b',
    role: 'primary',
    usagePct: null,
    reason: 'plan usage is unavailable, so the primary profile is kept',
  });
});

test('recommends per provider', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies: [
        makePolicy('org-acme', 'claude-a', 'primary', 0),
        makePolicy('org-acme', 'codex-a', 'primary', 1),
      ],
      profiles: [makeProfile('claude-a'), makeProfile('codex-a', { provider: 'codex' })],
      usage: { 'claude-a': usageAt(10), 'codex-a': usageAt(20) },
    }),
  );

  assert.equal((await recommend(PROJECT, 'codex', {}, deps)).profileId, 'codex-a');
  assert.equal((await recommend(PROJECT, 'claude', {}, deps)).profileId, 'claude-a');
});

test('an org with no policies recommends the provider default', async () => {
  const { deps } = createFakeDeps({
    profiles: [makeProfile('claude-a'), makeProfile('claude-b', { isDefault: true })],
    usage: { 'claude-a': usageAt(1), 'claude-b': usageAt(2) },
  });

  const result = await recommend('/home/me/project', undefined, {}, deps);

  assert.equal(result.profileId, 'claude-b');
  assert.equal(result.role, 'primary');
});

test('nothing eligible is a loud denial, not a silent pick', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'primary-a', 'primary', 0)],
      profiles: [makeProfile('primary-a', { authenticated: false })],
    }),
  );

  const { result: error, warnings } = await captureWarnings(async () => {
    try {
      await recommend(PROJECT, undefined, {}, deps);
      return null;
    } catch (thrown) {
      return thrown;
    }
  });

  assert.ok(error instanceof OrgPolicyError);
  assert.equal(error.code, 'ORG_POLICY_DENIED');
  assert.match(error.reason, /No eligible profile/);
  assert.ok(warnings.some((line) => /no eligible profile to recommend/.test(line)));
});
