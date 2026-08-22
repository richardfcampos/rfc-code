import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { orgsDb } from '@/modules/database/repositories/orgs.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'orgs-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function insertProfile(id: string, provider = 'claude', slug = id): void {
  getConnection()
    .prepare(`INSERT INTO profiles (id, provider, name, slug) VALUES (?, ?, ?, ?)`)
    .run(id, provider, id, slug);
}

test('migration seeds exactly one default org "Pessoal"', async () => {
  await withIsolatedDatabase(() => {
    const orgs = orgsDb.list();
    assert.equal(orgs.length, 1);
    assert.equal(orgs[0].name, 'Pessoal');
    assert.equal(orgs[0].is_default, 1);
    assert.equal(orgs[0].fallback_threshold, 85);
  });
});

test('seeding never creates a second default org once one exists', async () => {
  await withIsolatedDatabase(async () => {
    const db = getConnection();
    const { runMigrations } = await import('@/modules/database/migrations.js');

    runMigrations(db);
    runMigrations(db);

    const orgs = orgsDb.list();
    const defaults = orgs.filter((org) => org.is_default === 1);
    assert.equal(defaults.length, 1);
    assert.equal(orgs.filter((org) => org.name === 'Pessoal').length, 1);
  });
});

test('the default org cannot be deleted', async () => {
  await withIsolatedDatabase(() => {
    const defaultOrg = orgsDb.getDefault();
    assert.ok(defaultOrg);

    const deleted = orgsDb.delete(defaultOrg!.id);
    assert.equal(deleted, false);
    assert.ok(orgsDb.getById(defaultOrg!.id));
  });
});

test('a non-default org can be created and deleted', async () => {
  await withIsolatedDatabase(() => {
    const org = orgsDb.create('Acme', 90);
    assert.equal(org.name, 'Acme');
    assert.equal(org.is_default, 0);
    assert.equal(org.fallback_threshold, 90);

    const deleted = orgsDb.delete(org.id);
    assert.equal(deleted, true);
    assert.equal(orgsDb.getById(org.id), null);
  });
});

test('update rewrites name and threshold independently', async () => {
  await withIsolatedDatabase(() => {
    const org = orgsDb.create('Acme');

    const renamed = orgsDb.update(org.id, { name: 'Acme Corp' });
    assert.equal(renamed?.name, 'Acme Corp');
    assert.equal(renamed?.fallback_threshold, 85);

    const rethresholded = orgsDb.update(org.id, { fallbackThreshold: 50 });
    assert.equal(rethresholded?.name, 'Acme Corp');
    assert.equal(rethresholded?.fallback_threshold, 50);
  });
});

test('policy upsert is keyed by (org_id, profile_id) and never duplicates a row', async () => {
  await withIsolatedDatabase(() => {
    const org = orgsDb.create('Acme');
    insertProfile('profile-a');

    const first = orgsDb.policies.upsert(org.id, 'profile-a', 'primary', 0);
    const second = orgsDb.policies.upsert(org.id, 'profile-a', 'fallback', 5);

    assert.equal(first.id, second.id);
    assert.equal(second.role, 'fallback');
    assert.equal(second.priority, 5);

    const policies = orgsDb.policies.listByOrg(org.id);
    assert.equal(policies.length, 1);
  });
});

test('policies list primary roles before fallback roles, then by priority', async () => {
  await withIsolatedDatabase(() => {
    const org = orgsDb.create('Acme');
    insertProfile('profile-fallback');
    insertProfile('profile-primary-2');
    insertProfile('profile-primary-1');

    orgsDb.policies.upsert(org.id, 'profile-fallback', 'fallback', 0);
    orgsDb.policies.upsert(org.id, 'profile-primary-2', 'primary', 2);
    orgsDb.policies.upsert(org.id, 'profile-primary-1', 'primary', 1);

    const ordered = orgsDb.policies.listByOrg(org.id).map((policy) => policy.profile_id);
    assert.deepEqual(ordered, ['profile-primary-1', 'profile-primary-2', 'profile-fallback']);
  });
});

test('deleting an org cascades to its rules and policies', async () => {
  await withIsolatedDatabase(() => {
    const org = orgsDb.create('Acme');
    insertProfile('profile-a');

    orgsDb.rules.add(org.id, 'path_prefix', '/repos/acme');
    orgsDb.policies.upsert(org.id, 'profile-a', 'primary', 0);

    orgsDb.delete(org.id);

    const db = getConnection();
    const remainingRules = db
      .prepare('SELECT COUNT(*) AS count FROM org_project_rules WHERE org_id = ?')
      .get(org.id) as { count: number };
    const remainingPolicies = db
      .prepare('SELECT COUNT(*) AS count FROM org_profile_policies WHERE org_id = ?')
      .get(org.id) as { count: number };

    assert.equal(remainingRules.count, 0);
    assert.equal(remainingPolicies.count, 0);
  });
});

test('rules can be listed per org or across every org', async () => {
  await withIsolatedDatabase(() => {
    const orgA = orgsDb.create('Acme');
    const orgB = orgsDb.create('Globex');

    orgsDb.rules.add(orgA.id, 'path_prefix', '/repos/acme');
    orgsDb.rules.add(orgB.id, 'project_name', 'globex-api');

    assert.equal(orgsDb.rules.list(orgA.id).length, 1);
    assert.equal(orgsDb.rules.list(orgB.id).length, 1);
    assert.equal(orgsDb.rules.listAll().length, 2);
  });
});
