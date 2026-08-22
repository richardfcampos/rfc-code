import assert from 'node:assert/strict';
import test from 'node:test';

import { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';
import { resolveOrgForProject } from '@/modules/orgs/services/org-resolver.service.js';

import { captureWarnings, createFakeDeps, makeOrg, makeRule } from './support/fake-org-deps.js';

const defaultOrg = makeOrg('org-default', { name: 'Pessoal', isDefault: true });
const acmeOrg = makeOrg('org-acme', { name: 'Acme', threshold: 70 });
const labsOrg = makeOrg('org-labs', { name: 'Labs' });

test('an empty project path lands on the default org', () => {
  const { deps } = createFakeDeps({ orgs: [defaultOrg, acmeOrg] });

  assert.equal(resolveOrgForProject('', null, deps).id, 'org-default');
  assert.equal(resolveOrgForProject(null, null, deps).id, 'org-default');
  assert.equal(resolveOrgForProject(undefined, undefined, deps).id, 'org-default');
});

test('a path prefix rule claims the project and carries the org threshold', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg],
    rules: [makeRule('rule-1', 'org-acme', 'path_prefix', '/work/acme')],
  });

  const org = resolveOrgForProject('/work/acme/backend', null, deps);
  assert.equal(org.id, 'org-acme');
  assert.equal(org.fallbackThreshold, 70);
  assert.equal(org.isDefault, false);
});

test('the longest matching path prefix wins over a broader one', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg, labsOrg],
    rules: [
      makeRule('rule-1', 'org-labs', 'path_prefix', '/work'),
      makeRule('rule-2', 'org-acme', 'path_prefix', '/work/acme'),
    ],
  });

  assert.equal(resolveOrgForProject('/work/acme/api', null, deps).id, 'org-acme');
  assert.equal(resolveOrgForProject('/work/other', null, deps).id, 'org-labs');
});

test('prefix matching stops at a path boundary', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg, labsOrg],
    rules: [
      makeRule('rule-1', 'org-labs', 'path_prefix', '/work'),
      makeRule('rule-2', 'org-acme', 'path_prefix', '/work/acme'),
    ],
  });

  // A sibling directory that merely starts with the same characters is a
  // different project and must not inherit the stricter org.
  assert.equal(resolveOrgForProject('/work/acme-archive', null, deps).id, 'org-labs');
});

test('trailing slashes and windows separators do not change the match', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg],
    rules: [makeRule('rule-1', 'org-acme', 'path_prefix', 'C:/work/acme/')],
  });

  assert.equal(resolveOrgForProject('C:\\work\\acme\\api', null, deps).id, 'org-acme');
});

test('equal-length competing prefixes resolve deterministically by rule id', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg, labsOrg],
    rules: [
      makeRule('rule-b', 'org-labs', 'path_prefix', '/work/app'),
      makeRule('rule-a', 'org-acme', 'path_prefix', '/work/app'),
    ],
  });

  assert.equal(resolveOrgForProject('/work/app', null, deps).id, 'org-acme');
});

test('a project name rule applies when no path rule matches', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg],
    rules: [makeRule('rule-1', 'org-acme', 'project_name', 'checkout')],
  });

  assert.equal(resolveOrgForProject('/elsewhere/checkout', null, deps).id, 'org-acme');
  assert.equal(resolveOrgForProject(null, 'checkout', deps).id, 'org-acme');
  assert.equal(resolveOrgForProject('/elsewhere/other', null, deps).id, 'org-default');
});

test('a path rule outranks a name rule for the same project', () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg, acmeOrg, labsOrg],
    rules: [
      makeRule('rule-1', 'org-labs', 'project_name', 'api'),
      makeRule('rule-2', 'org-acme', 'path_prefix', '/work'),
    ],
  });

  assert.equal(resolveOrgForProject('/work/api', null, deps).id, 'org-acme');
});

test('a rule pointing at a missing org falls back to the default and says so', async () => {
  const { deps } = createFakeDeps({
    orgs: [defaultOrg],
    rules: [makeRule('rule-1', 'org-gone', 'path_prefix', '/work')],
  });

  const { result, warnings } = await captureWarnings(() =>
    resolveOrgForProject('/work/api', null, deps),
  );

  assert.equal(result.id, 'org-default');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /missing organization/);
});

test('a missing default org denies instead of failing open', async () => {
  const { deps } = createFakeDeps({ orgs: [acmeOrg] });

  const { result: error, warnings } = await captureWarnings(() => {
    try {
      resolveOrgForProject('/work/api', null, deps);
      return null;
    } catch (thrown) {
      return thrown;
    }
  });

  assert.ok(error instanceof OrgPolicyError);
  assert.equal(error.code, 'ORG_POLICY_DENIED');
  assert.equal(error.statusCode, 403);
  assert.equal(warnings.length, 1);
});
