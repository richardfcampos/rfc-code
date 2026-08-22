import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import type {
  OrgProfilePolicyRow,
  OrgProjectRuleRow,
  OrgRow,
} from '@/modules/database/index.js';
import { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';
import { createOrgsRouter } from '@/modules/orgs/orgs.routes.js';
import type {
  AllowedProfilesResult,
  OrgPolicyService,
  OrgProfileRole,
  OrgRecommendService,
  ProfileRecommendation,
} from '@/modules/orgs/orgs.types.js';
import {
  createOrgAdminService,
  type OrgsAdminRepository,
} from '@/modules/orgs/services/org-admin.service.js';
import { AppError } from '@/shared/utils.js';

const NOW = '2026-08-01T00:00:00.000Z';

interface OrgDetailPayload {
  id: string;
  name: string;
  isDefault: boolean;
  fallbackThreshold: number;
  rules: { id: string; kind: string; pattern: string }[];
  policies: { profileId: string; role: string; priority: number }[];
}

/**
 * In-memory stand-in for `orgsDb`, mirroring the ordering guarantees the real
 * SQL queries provide (default org first, policies primary-first by priority).
 */
function createMemoryRepository(defaultOrgName = 'Pessoal'): {
  repository: OrgsAdminRepository;
  policies: OrgProfilePolicyRow[];
} {
  const orgs: OrgRow[] = [{
    id: 'org-default',
    name: defaultOrgName,
    is_default: 1,
    fallback_threshold: 85,
    created_at: NOW,
  }];
  const rules: OrgProjectRuleRow[] = [];
  const policies: OrgProfilePolicyRow[] = [];
  let sequence = 0;
  const nextId = (prefix: string): string => `${prefix}-${++sequence}`;
  const roleRank = (role: OrgProfileRole): number => (role === 'primary' ? 0 : 1);

  const repository: OrgsAdminRepository = {
    list: () => [...orgs].sort(
      (left, right) =>
        right.is_default - left.is_default || left.name.localeCompare(right.name),
    ),
    getById: (id) => orgs.find((org) => org.id === id) ?? null,
    create: (name, fallbackThreshold = 85) => {
      const row: OrgRow = {
        id: nextId('org'),
        name,
        is_default: 0,
        fallback_threshold: fallbackThreshold,
        created_at: NOW,
      };
      orgs.push(row);
      return row;
    },
    update: (id, fields) => {
      const row = orgs.find((org) => org.id === id);
      if (!row) {
        return null;
      }
      if (fields.name !== undefined) {
        row.name = fields.name;
      }
      if (fields.fallbackThreshold !== undefined) {
        row.fallback_threshold = fields.fallbackThreshold;
      }
      return row;
    },
    delete: (id) => {
      const index = orgs.findIndex((org) => org.id === id);
      if (index < 0 || orgs[index]!.is_default === 1) {
        return false;
      }
      orgs.splice(index, 1);
      // Mirrors ON DELETE CASCADE.
      for (let cursor = rules.length - 1; cursor >= 0; cursor -= 1) {
        if (rules[cursor]!.org_id === id) {
          rules.splice(cursor, 1);
        }
      }
      for (let cursor = policies.length - 1; cursor >= 0; cursor -= 1) {
        if (policies[cursor]!.org_id === id) {
          policies.splice(cursor, 1);
        }
      }
      return true;
    },
    rules: {
      listAll: () => [...rules],
      add: (orgId, kind, pattern) => {
        const row: OrgProjectRuleRow = {
          id: nextId('rule'),
          org_id: orgId,
          kind,
          pattern,
          created_at: NOW,
        };
        rules.push(row);
        return row;
      },
      delete: (id) => {
        const index = rules.findIndex((rule) => rule.id === id);
        if (index < 0) {
          return false;
        }
        rules.splice(index, 1);
        return true;
      },
    },
    policies: {
      listByOrg: (orgId) => policies
        .filter((policy) => policy.org_id === orgId)
        .sort(
          (left, right) =>
            roleRank(left.role) - roleRank(right.role) || left.priority - right.priority,
        ),
      upsert: (orgId, profileId, role, priority = 0) => {
        const existing = policies.find(
          (policy) => policy.org_id === orgId && policy.profile_id === profileId,
        );
        if (existing) {
          existing.role = role;
          existing.priority = priority;
          return existing;
        }
        const row: OrgProfilePolicyRow = {
          id: nextId('policy'),
          org_id: orgId,
          profile_id: profileId,
          role,
          priority,
          created_at: NOW,
        };
        policies.push(row);
        return row;
      },
      delete: (id) => {
        const index = policies.findIndex((policy) => policy.id === id);
        if (index < 0) {
          return false;
        }
        policies.splice(index, 1);
        return true;
      },
    },
  };

  return { repository, policies };
}

function createFakePolicyService(overrides: Partial<OrgPolicyService> = {}): OrgPolicyService {
  return {
    listAllowedProfiles: () => {
      throw new Error('Unexpected listAllowedProfiles call');
    },
    assertProfileAllowed: () => {
      throw new Error('Unexpected assertProfileAllowed call');
    },
    resolveProfileForSpawn: async () => {
      throw new Error('Unexpected resolveProfileForSpawn call');
    },
    ...overrides,
  };
}

function createFakeRecommendService(
  recommendFn: OrgRecommendService['recommend'] = async () => {
    throw new Error('Unexpected recommend call');
  },
): OrgRecommendService {
  return { recommend: recommendFn };
}

interface ServerSetup {
  repository?: OrgsAdminRepository;
  profileIds?: string[];
  policy?: OrgPolicyService;
  recommend?: OrgRecommendService;
  runInTransaction?: <T>(work: () => T) => T;
}

async function withOrgsServer(
  setup: ServerSetup,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const repository = setup.repository ?? createMemoryRepository().repository;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/orgs',
    createOrgsRouter({
      admin: createOrgAdminService({
        repository,
        runInTransaction: setup.runInTransaction ?? ((work) => work()),
        listProfileIds: () => setup.profileIds ?? [],
      }),
      policy: setup.policy ?? createFakePolicyService(),
      recommend: setup.recommend ?? createFakeRecommendService(),
    }),
  );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.code, message: error.message });
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('orgs CRUD round-trip: create, list with rules and policies, patch, delete', async () => {
  const { repository } = createMemoryRepository();

  await withOrgsServer({ repository, profileIds: ['profile-a'] }, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/orgs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' Work ', fallbackThreshold: 70 }),
    });
    const createdPayload = (await created.json()) as { data: OrgDetailPayload };
    assert.equal(created.status, 201);
    assert.equal(createdPayload.data.name, 'Work');
    assert.equal(createdPayload.data.isDefault, false);
    assert.equal(createdPayload.data.fallbackThreshold, 70);
    assert.deepEqual(createdPayload.data.rules, []);
    assert.deepEqual(createdPayload.data.policies, []);

    const orgId = createdPayload.data.id;

    const ruleResponse = await fetch(`${baseUrl}/api/orgs/${orgId}/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'path_prefix', pattern: '/srv/work' }),
    });
    const rulePayload = (await ruleResponse.json()) as {
      data: { id: string; kind: string; pattern: string };
    };
    assert.equal(ruleResponse.status, 201);
    assert.equal(rulePayload.data.kind, 'path_prefix');
    assert.equal(rulePayload.data.pattern, '/srv/work');

    await fetch(`${baseUrl}/api/orgs/${orgId}/policies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ profileId: 'profile-a', role: 'primary', priority: 0 }]),
    });

    const listResponse = await fetch(`${baseUrl}/api/orgs`);
    const listPayload = (await listResponse.json()) as {
      success: boolean;
      data: OrgDetailPayload[];
    };
    assert.equal(listResponse.status, 200);
    assert.equal(listPayload.success, true);
    // Default org first, then by name — the repository ordering contract.
    assert.deepEqual(listPayload.data.map((org) => org.name), ['Pessoal', 'Work']);
    const work = listPayload.data[1]!;
    assert.equal(work.rules.length, 1);
    assert.equal(work.rules[0]!.pattern, '/srv/work');
    assert.deepEqual(work.policies, [{ profileId: 'profile-a', role: 'primary', priority: 0 }]);

    const patched = await fetch(`${baseUrl}/api/orgs/${orgId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Work EU', fallbackThreshold: 90 }),
    });
    const patchedPayload = (await patched.json()) as { data: OrgDetailPayload };
    assert.equal(patched.status, 200);
    assert.equal(patchedPayload.data.name, 'Work EU');
    assert.equal(patchedPayload.data.fallbackThreshold, 90);
    assert.equal(patchedPayload.data.rules.length, 1);

    const deleted = await fetch(`${baseUrl}/api/orgs/${orgId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);

    const afterDelete = await fetch(`${baseUrl}/api/orgs`);
    const afterPayload = (await afterDelete.json()) as { data: OrgDetailPayload[] };
    assert.deepEqual(afterPayload.data.map((org) => org.name), ['Pessoal']);
    // The org's rules went with it.
    assert.deepEqual(repository.rules.listAll(), []);
  });
});

test('org creation rejects an empty name and a name already in use', async () => {
  const { repository } = createMemoryRepository();

  await withOrgsServer({ repository }, async (baseUrl) => {
    const empty = await postJson(`${baseUrl}/api/orgs`, { name: '   ' });
    const emptyPayload = (await empty.json()) as { error: string };
    assert.equal(empty.status, 400);
    assert.equal(emptyPayload.error, 'ORG_VALIDATION_ERROR');

    // Case-insensitive: the default org is seeded as "Pessoal".
    const duplicate = await postJson(`${baseUrl}/api/orgs`, { name: 'pessoal' });
    const duplicatePayload = (await duplicate.json()) as { error: string };
    assert.equal(duplicate.status, 400);
    assert.equal(duplicatePayload.error, 'ORG_NAME_TAKEN');

    const badThreshold = await postJson(`${baseUrl}/api/orgs`, {
      name: 'Work',
      fallbackThreshold: 140,
    });
    assert.equal(badThreshold.status, 400);

    assert.deepEqual(repository.list().map((org) => org.name), ['Pessoal']);
  });
});

test('deleting the default org is refused with a named 400', async () => {
  const { repository } = createMemoryRepository();

  await withOrgsServer({ repository }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orgs/org-default`, { method: 'DELETE' });
    const payload = (await response.json()) as { error: string };

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'ORG_DEFAULT_PROTECTED');
    assert.equal(repository.list().length, 1);
  });
});

test('unknown orgs answer 404 on every parameterized route', async () => {
  await withOrgsServer({}, async (baseUrl) => {
    const patched = await fetch(`${baseUrl}/api/orgs/missing`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    });
    assert.equal(patched.status, 404);

    const ruled = await postJson(`${baseUrl}/api/orgs/missing/rules`, {
      kind: 'path_prefix',
      pattern: '/srv',
    });
    const ruledPayload = (await ruled.json()) as { error: string };
    assert.equal(ruled.status, 404);
    assert.equal(ruledPayload.error, 'ORG_NOT_FOUND');

    const deleted = await fetch(`${baseUrl}/api/orgs/missing`, { method: 'DELETE' });
    assert.equal(deleted.status, 404);
  });
});

test('project rules are validated and can only be deleted through their own org', async () => {
  const { repository } = createMemoryRepository();
  const other = repository.create('Other');
  const foreignRule = repository.rules.add(other.id, 'project_name', 'other-app');

  await withOrgsServer({ repository }, async (baseUrl) => {
    const badKind = await postJson(`${baseUrl}/api/orgs/org-default/rules`, {
      kind: 'regex',
      pattern: '/srv',
    });
    assert.equal(badKind.status, 400);

    const emptyPattern = await postJson(`${baseUrl}/api/orgs/org-default/rules`, {
      kind: 'project_name',
      pattern: '  ',
    });
    assert.equal(emptyPattern.status, 400);

    const crossOrg = await fetch(
      `${baseUrl}/api/orgs/org-default/rules/${foreignRule.id}`,
      { method: 'DELETE' },
    );
    const crossPayload = (await crossOrg.json()) as { error: string };
    assert.equal(crossOrg.status, 404);
    assert.equal(crossPayload.error, 'ORG_RULE_NOT_FOUND');
    // Still owned by the other org.
    assert.equal(repository.rules.listAll().length, 1);

    const owned = await fetch(`${baseUrl}/api/orgs/${other.id}/rules/${foreignRule.id}`, {
      method: 'DELETE',
    });
    assert.equal(owned.status, 204);
    assert.deepEqual(repository.rules.listAll(), []);
  });
});

test('PUT policies replaces the whole list inside one transaction', async () => {
  const { repository, policies } = createMemoryRepository();
  repository.policies.upsert('org-default', 'profile-old', 'primary', 0);
  let transactions = 0;

  await withOrgsServer(
    {
      repository,
      profileIds: ['profile-a', 'profile-b'],
      runInTransaction: (work) => {
        transactions += 1;
        return work();
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/orgs/org-default/policies`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([
          { profileId: 'profile-b', role: 'fallback', priority: 0 },
          { profileId: 'profile-a', role: 'primary', priority: 1 },
        ]),
      });
      const payload = (await response.json()) as {
        data: { profileId: string; role: string; priority: number }[];
      };

      assert.equal(response.status, 200);
      // Returned in the resolver's own walk order: primaries first.
      assert.deepEqual(payload.data, [
        { profileId: 'profile-a', role: 'primary', priority: 1 },
        { profileId: 'profile-b', role: 'fallback', priority: 0 },
      ]);
    },
  );

  assert.equal(transactions, 1);
  // The previously allowed account is gone, not merged.
  assert.deepEqual(policies.map((policy) => policy.profile_id).sort(), ['profile-a', 'profile-b']);
});

test('PUT policies rejects unknown, duplicated or malformed entries without writing', async () => {
  const { repository, policies } = createMemoryRepository();
  repository.policies.upsert('org-default', 'profile-a', 'primary', 0);
  let transactions = 0;

  const putPolicies = async (baseUrl: string, body: unknown) =>
    fetch(`${baseUrl}/api/orgs/org-default/policies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  await withOrgsServer(
    {
      repository,
      profileIds: ['profile-a'],
      runInTransaction: (work) => {
        transactions += 1;
        return work();
      },
    },
    async (baseUrl) => {
      const unknownProfile = await putPolicies(baseUrl, [
        { profileId: 'ghost', role: 'primary', priority: 0 },
      ]);
      assert.equal(unknownProfile.status, 400);

      const duplicated = await putPolicies(baseUrl, [
        { profileId: 'profile-a', role: 'primary', priority: 0 },
        { profileId: 'profile-a', role: 'fallback', priority: 1 },
      ]);
      assert.equal(duplicated.status, 400);

      const badRole = await putPolicies(baseUrl, [{ profileId: 'profile-a', role: 'owner' }]);
      assert.equal(badRole.status, 400);

      const notAnArray = await putPolicies(baseUrl, { profileId: 'profile-a' });
      const notAnArrayPayload = (await notAnArray.json()) as { error: string };
      assert.equal(notAnArray.status, 400);
      assert.equal(notAnArrayPayload.error, 'ORG_VALIDATION_ERROR');
    },
  );

  assert.equal(transactions, 0);
  assert.deepEqual(policies.map((policy) => policy.profile_id), ['profile-a']);
});

test('PUT policies with an empty list clears the allow-list', async () => {
  const { repository, policies } = createMemoryRepository();
  repository.policies.upsert('org-default', 'profile-a', 'primary', 0);

  await withOrgsServer({ repository, profileIds: ['profile-a'] }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orgs/org-default/policies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([]),
    });
    const payload = (await response.json()) as { data: unknown[] };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.data, []);
  });

  assert.deepEqual(policies, []);
});

test('GET /allowed-profiles forwards the project and provider filters', async () => {
  const calls: { projectPath: string | null | undefined; provider: string | undefined }[] = [];
  const result: AllowedProfilesResult = {
    orgId: 'org-default',
    orgName: 'Pessoal',
    policyManaged: true,
    fallbackThreshold: 85,
    profiles: [{ profileId: 'profile-a', role: 'primary', priority: 0 }],
  };

  await withOrgsServer(
    {
      policy: createFakePolicyService({
        listAllowedProfiles: (projectPath, options) => {
          calls.push({ projectPath, provider: options?.provider });
          return result;
        },
      }),
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/orgs/allowed-profiles?project=${encodeURIComponent('/srv/app')}&provider=claude`,
      );
      const payload = (await response.json()) as { data: AllowedProfilesResult };

      assert.equal(response.status, 200);
      assert.deepEqual(payload.data, result);

      // An absent project is a valid question: it resolves to the default org.
      const withoutProject = await fetch(`${baseUrl}/api/orgs/allowed-profiles`);
      assert.equal(withoutProject.status, 200);

      const badProvider = await fetch(`${baseUrl}/api/orgs/allowed-profiles?provider=gemini`);
      const badPayload = (await badProvider.json()) as { error: string };
      assert.equal(badProvider.status, 400);
      assert.equal(badPayload.error, 'ORG_VALIDATION_ERROR');
    },
  );

  assert.deepEqual(calls, [
    { projectPath: '/srv/app', provider: 'claude' },
    { projectPath: null, provider: undefined },
  ]);
});

test('GET /recommend returns the recommendation and surfaces a denial as 403', async () => {
  const recommendation: ProfileRecommendation = {
    profileId: 'profile-a',
    role: 'primary',
    usagePct: 12,
    reason: 'primary profile below the 85% usage threshold',
  };
  const calls: (string | null | undefined)[] = [];

  await withOrgsServer(
    {
      recommend: createFakeRecommendService(async (projectPath) => {
        calls.push(projectPath);
        if (projectPath === '/srv/locked') {
          throw new OrgPolicyError('No eligible profile for organization "Work".');
        }
        return recommendation;
      }),
    },
    async (baseUrl) => {
      const ok = await fetch(`${baseUrl}/api/orgs/recommend?project=${encodeURIComponent('/srv/app')}`);
      const okPayload = (await ok.json()) as { data: ProfileRecommendation };
      assert.equal(ok.status, 200);
      assert.deepEqual(okPayload.data, recommendation);

      const denied = await fetch(
        `${baseUrl}/api/orgs/recommend?project=${encodeURIComponent('/srv/locked')}`,
      );
      const deniedPayload = (await denied.json()) as { error: string; message: string };
      assert.equal(denied.status, 403);
      assert.equal(deniedPayload.error, 'ORG_POLICY_DENIED');
      assert.match(deniedPayload.message, /No eligible profile/);
    },
  );

  assert.deepEqual(calls, ['/srv/app', '/srv/locked']);
});
