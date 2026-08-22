import assert from 'node:assert/strict';
import test from 'node:test';

import { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';
import {
  assertProfileAllowed,
  listAllowedProfiles,
} from '@/modules/orgs/services/profile-policy.service.js';

import {
  captureWarnings,
  createFakeDeps,
  makeOrg,
  makePolicy,
  makeProfile,
  makeRule,
} from './support/fake-org-deps.js';

const defaultOrg = makeOrg('org-default', { name: 'Pessoal', isDefault: true });
const acmeOrg = makeOrg('org-acme', { name: 'Acme' });
const acmeRule = makeRule('rule-acme', 'org-acme', 'path_prefix', '/work/acme');

test('an org with no policies allows every profile, provider default first', () => {
  const { deps } = createFakeDeps({
    profiles: [
      makeProfile('claude-a'),
      makeProfile('claude-b', { isDefault: true }),
      makeProfile('codex-a', { provider: 'codex' }),
    ],
  });

  const result = listAllowedProfiles('/work/anything', {}, deps);

  assert.equal(result.policyManaged, false);
  assert.equal(result.orgId, 'org-default');
  assert.equal(result.fallbackThreshold, 85);
  assert.deepEqual(
    result.profiles.map((profile) => profile.profileId),
    ['claude-b', 'claude-a', 'codex-a'],
  );
  assert.ok(result.profiles.every((profile) => profile.role === 'primary'));
});

test('an org with no policies still denies a profile that does not exist', async () => {
  const { deps } = createFakeDeps({ profiles: [makeProfile('claude-a')] });

  assertProfileAllowed('/work/anything', 'claude-a', deps);

  const { result: error, warnings } = await captureWarnings(() => {
    try {
      assertProfileAllowed('/work/anything', 'ghost', deps);
      return null;
    } catch (thrown) {
      return thrown;
    }
  });

  assert.ok(error instanceof OrgPolicyError);
  assert.match(error.reason, /does not exist/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /profile denied/);
});

test('an org with policies denies anything outside the allow-list, loudly', async () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg],
    rules: [acmeRule],
    policies: [makePolicy('org-acme', 'work-primary', 'primary', 0)],
    profiles: [makeProfile('work-primary'), makeProfile('personal')],
  });

  assertProfileAllowed('/work/acme/api', 'work-primary', deps);

  const { result: error, warnings } = await captureWarnings(() => {
    try {
      assertProfileAllowed('/work/acme/api', 'personal', deps);
      return null;
    } catch (thrown) {
      return thrown;
    }
  });

  assert.ok(error instanceof OrgPolicyError);
  assert.equal(error.code, 'ORG_POLICY_DENIED');
  assert.equal(error.statusCode, 403);
  assert.match(error.reason, /not allowed in organization "Acme"/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /"profileId":"personal"/);
});

test('the same profile can be denied in one org and allowed in another', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg],
    rules: [acmeRule],
    policies: [makePolicy('org-acme', 'work-primary', 'primary', 0)],
    profiles: [makeProfile('work-primary'), makeProfile('personal')],
  });

  // The default org has no policies at all, so it keeps the compat behavior.
  assertProfileAllowed('/home/me/side-project', 'personal', deps);
  assert.throws(() => assertProfileAllowed('/work/acme/api', 'personal', deps), OrgPolicyError);
});

test('the allow-list keeps primaries before fallbacks and honors priority', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg],
    rules: [acmeRule],
    policies: [
      makePolicy('org-acme', 'spare', 'fallback', 0),
      makePolicy('org-acme', 'second', 'primary', 1),
      makePolicy('org-acme', 'first', 'primary', 0),
    ],
    profiles: [makeProfile('spare'), makeProfile('second'), makeProfile('first')],
  });

  const result = listAllowedProfiles('/work/acme/api', {}, deps);

  assert.equal(result.policyManaged, true);
  assert.deepEqual(
    result.profiles.map((profile) => `${profile.profileId}:${profile.role}`),
    ['first:primary', 'second:primary', 'spare:fallback'],
  );
});

test('the allow-list can be narrowed to one provider', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg],
    rules: [acmeRule],
    policies: [
      makePolicy('org-acme', 'claude-a', 'primary', 0),
      makePolicy('org-acme', 'codex-a', 'primary', 1),
    ],
    profiles: [makeProfile('claude-a'), makeProfile('codex-a', { provider: 'codex' })],
  });

  const result = listAllowedProfiles('/work/acme/api', { provider: 'codex' }, deps);

  assert.deepEqual(
    result.profiles.map((profile) => profile.profileId),
    ['codex-a'],
  );
});

test('a policy left behind by a deleted profile is dropped and reported', async () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg],
    rules: [acmeRule],
    policies: [
      makePolicy('org-acme', 'gone', 'primary', 0),
      makePolicy('org-acme', 'alive', 'primary', 1),
    ],
    profiles: [makeProfile('alive')],
  });

  const { result, warnings } = await captureWarnings(() =>
    listAllowedProfiles('/work/acme/api', {}, deps),
  );

  assert.deepEqual(
    result.profiles.map((profile) => profile.profileId),
    ['alive'],
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /missing profile/);
});
