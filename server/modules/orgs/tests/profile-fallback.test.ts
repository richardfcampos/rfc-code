import assert from 'node:assert/strict';
import test from 'node:test';

import { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';
import { resolveProfileForSpawn } from '@/modules/orgs/services/profile-policy.service.js';

import {
  captureWarnings,
  createFakeDeps,
  makeOrg,
  makePolicy,
  makeProfile,
  makeRule,
  usageAt,
  usageUnauthenticated,
  usageUnavailable,
  type FakeSetup,
} from './support/fake-org-deps.js';

const PROJECT = '/work/acme/api';

/** Org `Acme` (threshold 85) governing `/work/acme`, plus the untouched default. */
function acmeSetup(overrides: Partial<FakeSetup>): FakeSetup {
  return {
    orgs: [makeOrg('org-default', { name: 'Pessoal', isDefault: true }), makeOrg('org-acme', { name: 'Acme' })],
    rules: [makeRule('rule-acme', 'org-acme', 'path_prefix', '/work/acme')],
    ...overrides,
  };
}

const twoTierPolicies = [
  makePolicy('org-acme', 'primary-a', 'primary', 0),
  makePolicy('org-acme', 'primary-b', 'primary', 1),
  makePolicy('org-acme', 'spare', 'fallback', 0),
];

const twoTierProfiles = [makeProfile('primary-a'), makeProfile('primary-b'), makeProfile('spare')];

test('a primary below the threshold is used and nothing is audited', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: twoTierPolicies,
      profiles: twoTierProfiles,
      usage: { 'primary-a': usageAt(40), 'primary-b': usageAt(10), spare: usageAt(0) },
    }),
  );

  const selection = await resolveProfileForSpawn(PROJECT, {}, deps);

  assert.deepEqual(selection, { profileId: 'primary-a', role: 'primary' });
  assert.equal(audits.length, 0);
});

test('priority decides which under-threshold primary runs', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies: twoTierPolicies,
      profiles: twoTierProfiles,
      usage: { 'primary-a': usageAt(90), 'primary-b': usageAt(20), spare: usageAt(0) },
    }),
  );

  const selection = await resolveProfileForSpawn(PROJECT, {}, deps);

  assert.equal(selection.profileId, 'primary-b');
  assert.equal(selection.fallback, undefined);
});

test('a primary exactly at the threshold counts as exhausted and unlocks the fallback', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'primary-a', 'primary', 0), makePolicy('org-acme', 'spare', 'fallback', 0)],
      profiles: [makeProfile('primary-a'), makeProfile('spare')],
      usage: { 'primary-a': usageAt(85), spare: usageAt(5) },
    }),
  );

  const { result: selection, warnings } = await captureWarnings(() =>
    resolveProfileForSpawn(PROJECT, { sessionId: 'session-1' }, deps),
  );

  assert.equal(selection.profileId, 'spare');
  assert.equal(selection.role, 'fallback');
  assert.match(selection.fallback!.reason, /at or above the 85% usage threshold/);
  assert.equal(selection.fallback!.primaryUsagePct, 85);

  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], {
    orgId: 'org-acme',
    profileId: 'spare',
    projectName: 'api',
    sessionId: 'session-1',
    reason: selection.fallback!.reason,
    primaryUsagePct: 85,
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /fallback profile granted/);
});

test('every primary must be exhausted before the fallback opens', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: twoTierPolicies,
      profiles: twoTierProfiles,
      usage: { 'primary-a': usageAt(99), 'primary-b': usageAt(84), spare: usageAt(0) },
    }),
  );

  const selection = await resolveProfileForSpawn(PROJECT, {}, deps);

  assert.equal(selection.profileId, 'primary-b');
  assert.equal(audits.length, 0);
});

test('the highest primary usage is what the audit records', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: twoTierPolicies,
      profiles: twoTierProfiles,
      usage: { 'primary-a': usageAt(88), 'primary-b': usageAt(97), spare: usageAt(3) },
    }),
  );

  const { result: selection } = await captureWarnings(() => resolveProfileForSpawn(PROJECT, {}, deps));

  assert.equal(selection.profileId, 'spare');
  assert.equal(audits[0]!.primaryUsagePct, 97);
});

test('an unreadable usage snapshot keeps the fallback locked', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: twoTierPolicies,
      profiles: twoTierProfiles,
      usage: { 'primary-a': usageAt(95), 'primary-b': usageUnavailable, spare: usageAt(0) },
    }),
  );

  const { result: selection } = await captureWarnings(() => resolveProfileForSpawn(PROJECT, {}, deps));

  // Unknown is not proof of exhaustion: spending the fallback here would burn a
  // second subscription on a guess.
  assert.equal(selection.profileId, 'primary-b');
  assert.equal(selection.role, 'primary');
  assert.equal(selection.fallback, undefined);
  assert.equal(audits.length, 0);
});

test('a usage lookup that throws is treated as unknown, not as exhausted', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'primary-a', 'primary', 0), makePolicy('org-acme', 'spare', 'fallback', 0)],
      profiles: [makeProfile('primary-a'), makeProfile('spare')],
      usage: { 'primary-a': new Error('network down'), spare: usageAt(0) },
    }),
  );

  const { result: selection, warnings } = await captureWarnings(() =>
    resolveProfileForSpawn(PROJECT, {}, deps),
  );

  assert.equal(selection.profileId, 'primary-a');
  assert.equal(audits.length, 0);
  assert.ok(warnings.some((line) => /plan usage lookup failed/.test(line)));
});

test('a signed-out primary is exhausted and unlocks the fallback', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'primary-a', 'primary', 0), makePolicy('org-acme', 'spare', 'fallback', 0)],
      profiles: [makeProfile('primary-a', { authenticated: false }), makeProfile('spare')],
      usage: { spare: usageAt(10) },
    }),
  );

  const { result: selection } = await captureWarnings(() => resolveProfileForSpawn(PROJECT, {}, deps));

  assert.equal(selection.profileId, 'spare');
  assert.match(selection.fallback!.reason, /signed out/);
  assert.equal(selection.fallback!.primaryUsagePct, null);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.primaryUsagePct, null);
});

test('a provider reporting no login unlocks the fallback even when the profile looks authenticated', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'primary-a', 'primary', 0), makePolicy('org-acme', 'spare', 'fallback', 0)],
      profiles: [makeProfile('primary-a'), makeProfile('spare')],
      usage: { 'primary-a': usageUnauthenticated, spare: usageAt(10) },
    }),
  );

  const { result: selection } = await captureWarnings(() => resolveProfileForSpawn(PROJECT, {}, deps));

  assert.equal(selection.profileId, 'spare');
});

test('mixing an exhausted and a signed-out primary is reported as both', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies: twoTierPolicies,
      profiles: [
        makeProfile('primary-a'),
        makeProfile('primary-b', { authenticated: false }),
        makeProfile('spare'),
      ],
      usage: { 'primary-a': usageAt(91), spare: usageAt(0) },
    }),
  );

  const { result: selection } = await captureWarnings(() => resolveProfileForSpawn(PROJECT, {}, deps));

  assert.equal(selection.profileId, 'spare');
  assert.match(selection.fallback!.reason, /threshold or signed out/);
  assert.equal(selection.fallback!.primaryUsagePct, 91);
});

test('a provider with no primary at all falls back and says why', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'codex-spare', 'fallback', 0)],
      profiles: [makeProfile('codex-spare', { provider: 'codex' })],
      usage: { 'codex-spare': usageAt(12) },
    }),
  );

  const { result: selection } = await captureWarnings(() =>
    resolveProfileForSpawn(PROJECT, { provider: 'codex' }, deps),
  );

  assert.equal(selection.profileId, 'codex-spare');
  assert.match(selection.fallback!.reason, /no primary profile is configured/);
  assert.equal(audits.length, 1);
});

test('a requested profile is honored when allowed and refused when not', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: twoTierPolicies,
      profiles: [...twoTierProfiles, makeProfile('personal')],
      usage: { 'primary-a': usageAt(5), 'primary-b': usageAt(5), spare: usageAt(5) },
    }),
  );

  // Quota is not a permission boundary: an explicit pick is never overridden.
  const selection = await resolveProfileForSpawn(PROJECT, { requestedProfileId: 'spare' }, deps);
  assert.deepEqual(selection, { profileId: 'spare', role: 'fallback' });
  assert.equal(audits.length, 0);

  const { result: error } = await captureWarnings(async () => {
    try {
      await resolveProfileForSpawn(PROJECT, { requestedProfileId: 'personal' }, deps);
      return null;
    } catch (thrown) {
      return thrown;
    }
  });
  assert.ok(error instanceof OrgPolicyError);
  assert.equal(error.code, 'ORG_POLICY_DENIED');
});

test('exhausted primaries with no fallback still start a session', async () => {
  const { deps, audits } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'primary-a', 'primary', 0)],
      profiles: [makeProfile('primary-a')],
      usage: { 'primary-a': usageAt(99) },
    }),
  );

  const { result: selection, warnings } = await captureWarnings(() =>
    resolveProfileForSpawn(PROJECT, {}, deps),
  );

  // Running out of quota is not a policy denial; refusing here would lock a
  // single-account installation out of its own app.
  assert.deepEqual(selection, { profileId: 'primary-a', role: 'primary' });
  assert.equal(audits.length, 0);
  assert.ok(warnings.some((line) => /no profile below the usage threshold/.test(line)));
});

test('an org that allows nothing for the provider denies the spawn', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'claude-a', 'primary', 0)],
      profiles: [makeProfile('claude-a')],
    }),
  );

  const { result: error, warnings } = await captureWarnings(async () => {
    try {
      await resolveProfileForSpawn(PROJECT, { provider: 'codex' }, deps);
      return null;
    } catch (thrown) {
      return thrown;
    }
  });

  assert.ok(error instanceof OrgPolicyError);
  assert.match(error.reason, /allows no profile/);
  assert.ok(warnings.some((line) => /no allowed profile/.test(line)));
});

test('a failed audit write costs a log line, not the session', async () => {
  const { deps } = createFakeDeps(
    acmeSetup({
      policies: [makePolicy('org-acme', 'primary-a', 'primary', 0), makePolicy('org-acme', 'spare', 'fallback', 0)],
      profiles: [makeProfile('primary-a'), makeProfile('spare')],
      usage: { 'primary-a': usageAt(95), spare: usageAt(1) },
      auditInsert: () => {
        throw new Error('database is locked');
      },
    }),
  );

  const { result: selection, warnings } = await captureWarnings(() =>
    resolveProfileForSpawn(PROJECT, {}, deps),
  );

  assert.equal(selection.profileId, 'spare');
  assert.ok(warnings.some((line) => /failed to record fallback audit/.test(line)));
});

test('an installation with one signed-out account keeps working (zero-policy compat)', async () => {
  const { deps, audits } = createFakeDeps({
    profiles: [makeProfile('solo', { authenticated: false, isDefault: true })],
  });

  const { result: selection } = await captureWarnings(() =>
    resolveProfileForSpawn('/home/me/project', {}, deps),
  );

  assert.deepEqual(selection, { profileId: 'solo', role: 'primary' });
  assert.equal(audits.length, 0);
});
