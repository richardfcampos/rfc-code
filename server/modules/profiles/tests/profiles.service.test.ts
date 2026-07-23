import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  sessionsDb,
} from '@/modules/database/index.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';

/**
 * Runs a test against an ephemeral DB and an ephemeral PROFILES_ROOT so every
 * on-disk config directory the service creates is isolated and cleaned up.
 */
async function withProfilesEnvironment(
  runTest: (profilesRoot: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousProfilesRoot = process.env.PROFILES_ROOT;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'profiles-service-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const profilesRoot = path.join(tempDirectory, 'profiles');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.PROFILES_ROOT = profilesRoot;
  await initializeDatabase();

  try {
    await runTest(profilesRoot);
  } finally {
    closeConnection();
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('PROFILES_ROOT', previousProfilesRoot);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

// HUB-05 AC1: creating a profile provisions an isolated config directory.
test('createProfile provisions an isolated on-disk config directory', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Claude Max A' });

    const expectedDir = path.join(profilesRoot, 'claude', profile.slug);
    assert.equal(fs.existsSync(expectedDir), true);
    assert.equal(fs.statSync(expectedDir).isDirectory(), true);
    assert.equal(profile.provider, 'claude');
    assert.equal(profile.slug, 'claude-max-a');
  });
});

// HUB-05 AC4: two profiles of the same provider never share a config dir/env.
test('two claude profiles resolve to distinct, isolated CLAUDE_CONFIG_DIR values', async () => {
  await withProfilesEnvironment(() => {
    const a = profilesService.createProfile({ provider: 'claude', name: 'Account A' });
    const b = profilesService.createProfile({ provider: 'claude', name: 'Account B' });

    const envA = profilesService.resolveEnv(a.id);
    const envB = profilesService.resolveEnv(b.id);

    assert.ok(envA.CLAUDE_CONFIG_DIR);
    assert.ok(envB.CLAUDE_CONFIG_DIR);
    assert.notEqual(envA.CLAUDE_CONFIG_DIR, envB.CLAUDE_CONFIG_DIR);
  });
});

// HUB-05 AC4: duplicate names of the same provider get distinct slugs (no dir collision).
test('duplicate names under one provider allocate distinct slugs', async () => {
  await withProfilesEnvironment(() => {
    const first = profilesService.createProfile({ provider: 'codex', name: 'Work' });
    const second = profilesService.createProfile({ provider: 'codex', name: 'Work' });

    assert.equal(first.slug, 'work');
    assert.equal(second.slug, 'work-2');
    assert.notEqual(
      profilesService.resolveEnv(first.id).CODEX_HOME,
      profilesService.resolveEnv(second.id).CODEX_HOME,
    );
  });
});

// resolveEnv maps each provider to its native isolation variable(s).
test('resolveEnv returns the correct native variable for every provider', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const claude = profilesService.createProfile({ provider: 'claude', name: 'C' });
    const codex = profilesService.createProfile({ provider: 'codex', name: 'C' });
    const cursor = profilesService.createProfile({ provider: 'cursor', name: 'C' });
    const opencode = profilesService.createProfile({ provider: 'opencode', name: 'C' });

    assert.deepEqual(profilesService.resolveEnv(claude.id), {
      CLAUDE_CONFIG_DIR: path.join(profilesRoot, 'claude', 'c'),
    });
    assert.deepEqual(profilesService.resolveEnv(codex.id), {
      CODEX_HOME: path.join(profilesRoot, 'codex', 'c'),
    });
    assert.deepEqual(profilesService.resolveEnv(cursor.id), {
      HOME: path.join(profilesRoot, 'cursor', 'c'),
    });
    assert.deepEqual(profilesService.resolveEnv(opencode.id), {
      XDG_CONFIG_HOME: path.join(profilesRoot, 'opencode', 'c', 'config'),
      XDG_DATA_HOME: path.join(profilesRoot, 'opencode', 'c', 'data'),
    });
  });
});

// Retrocompat: a session with no profile keeps the CLI's default config dir.
test('resolveEnv with no profileId returns an empty environment', async () => {
  await withProfilesEnvironment(() => {
    assert.deepEqual(profilesService.resolveEnv(undefined), {});
    assert.deepEqual(profilesService.resolveEnv(null), {});
    assert.deepEqual(profilesService.resolveEnv(''), {});
  });
});

// A dangling profile id is a hard error, never a silent fallback to another account.
test('resolveEnv throws for an unknown profile id', async () => {
  await withProfilesEnvironment(() => {
    assert.throws(() => profilesService.resolveEnv('does-not-exist'), /not.*found/i);
  });
});

// HUB-05 AC3: a freshly created profile reports as not authenticated.
test('getAuthStatus reports not-authenticated until a credential is present', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Fresh' });
    assert.deepEqual(profilesService.getAuthStatus(profile.id), { authenticated: false });

    // Simulate a completed login writing the provider credential artifact.
    const credentialPath = path.join(profilesRoot, 'claude', profile.slug, '.credentials.json');
    fs.writeFileSync(credentialPath, '{"token":"x"}');
    assert.deepEqual(profilesService.getAuthStatus(profile.id), { authenticated: true });
  });
});

// Input validation at the service boundary.
test('createProfile rejects an invalid provider and an empty name', async () => {
  await withProfilesEnvironment(() => {
    assert.throws(
      () => profilesService.createProfile({ provider: 'gpt', name: 'X' }),
      /unsupported provider/i,
    );
    assert.throws(
      () => profilesService.createProfile({ provider: 'claude', name: '   ' }),
      /name is required/i,
    );
  });
});

// T5 error path is enforced here: deleting a profile with a live session fails.
test('deleteProfile refuses while a non-archived session is bound to it', async () => {
  await withProfilesEnvironment(() => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Busy' });

    sessionsDb.createAppSession('s-live', 'claude', '/workspace/demo');
    // Bind the session to the profile. The sessions repository does not yet
    // expose a profile setter (that arrives with the profile-aware sync work),
    // so stamp profile_id directly, matching what will be persisted later.
    getConnection()
      .prepare('UPDATE sessions SET profile_id = ? WHERE session_id = ?')
      .run(profile.id, 's-live');

    assert.throws(() => profilesService.deleteProfile(profile.id), /active session/i);

    // Archiving the session releases the profile for deletion.
    sessionsDb.updateSessionIsArchived('s-live', true);
    assert.doesNotThrow(() => profilesService.deleteProfile(profile.id));
  });
});

// listProfiles filters by provider and returns created profiles.
test('listProfiles returns profiles and filters by provider', async () => {
  await withProfilesEnvironment(() => {
    profilesService.createProfile({ provider: 'claude', name: 'A' });
    profilesService.createProfile({ provider: 'codex', name: 'B' });

    assert.equal(profilesService.listProfiles().length, 2);
    const claudeOnly = profilesService.listProfiles('claude');
    assert.equal(claudeOnly.length, 1);
    assert.equal(claudeOnly[0]?.provider, 'claude');
  });
});
