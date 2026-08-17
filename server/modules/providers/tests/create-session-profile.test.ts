import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { profilesService } from '@/modules/profiles/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

async function withProfilesEnvironment(
  runTest: () => void | Promise<void>,
): Promise<void> {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
  };
  const tempDir = await mkdtemp(path.join(tmpdir(), 'create-session-profile-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempDir, 'profiles');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

// HUB-05 AC2: choosing a profile at session creation stamps the session with
// that profile so later dispatch (and the header badge) know which account is
// in use, without waiting for a synchronizer pass to discover it on disk.
test('createAppSession persists the given profileId on the session row', async () => {
  await withProfilesEnvironment(async () => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Account A' });

    const result = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      profile.id,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );

    assert.equal(sessionsDb.getSessionById(result.sessionId)?.profile_id, profile.id);
  });
});

// Retrocompat: no profileId keeps upstream behavior — session has no owning profile.
test('createAppSession leaves profile_id null when no profileId is given', async () => {
  await withProfilesEnvironment(async () => {
    const result = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );

    assert.equal(sessionsDb.getSessionById(result.sessionId)?.profile_id, null);
  });
});

// A dangling profile id is a hard error, never a silently persisted ghost reference.
test('createAppSession rejects an unknown profileId', async () => {
  await withProfilesEnvironment(async () => {
    await assert.rejects(
      () =>
        sessionsService.createAppSession(
          'claude',
          '/workspace/demo',
          'does-not-exist',
          async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
        ),
      /not.*found/i,
    );
  });
});

// A new session with no explicit pick lands on the provider's default account
// instead of the provider CLI's own config directory.
test('createAppSession falls back to the provider default profile', async () => {
  await withProfilesEnvironment(async () => {
    const fallback = profilesService.createProfile({ provider: 'claude', name: 'Fallback' });
    profilesService.setDefaultProfile(fallback.id, true);

    const result = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );

    assert.equal(result.profileId, fallback.id);
    assert.equal(sessionsDb.getSessionById(result.sessionId)?.profile_id, fallback.id);
  });
});

// The default only fills a missing pick: an explicit account always wins.
test('createAppSession prefers the explicit profileId over the default', async () => {
  await withProfilesEnvironment(async () => {
    const fallback = profilesService.createProfile({ provider: 'claude', name: 'Fallback' });
    const chosen = profilesService.createProfile({ provider: 'claude', name: 'Chosen' });
    profilesService.setDefaultProfile(fallback.id, true);

    const result = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      chosen.id,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );

    assert.equal(sessionsDb.getSessionById(result.sessionId)?.profile_id, chosen.id);
  });
});

// A default set for one provider must not leak into another provider's
// sessions — the credentials it points at belong to a different CLI.
test('createAppSession ignores a default belonging to another provider', async () => {
  await withProfilesEnvironment(async () => {
    const codexDefault = profilesService.createProfile({ provider: 'codex', name: 'Codex' });
    profilesService.setDefaultProfile(codexDefault.id, true);

    const result = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );

    assert.equal(sessionsDb.getSessionById(result.sessionId)?.profile_id, null);
  });
});
