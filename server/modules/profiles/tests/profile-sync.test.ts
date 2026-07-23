import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';
import {
  resolveProfileRootForPath,
  resolveProfileScanRoots,
} from '@/modules/profiles/profile-sync.js';

async function withProfilesEnvironment(
  runTest: (profilesRoot: string) => void | Promise<void>,
): Promise<void> {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
  };
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'profile-sync-'));
  const profilesRoot = path.join(tempDirectory, 'profiles');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = profilesRoot;
  await initializeDatabase();

  try {
    await runTest(profilesRoot);
  } finally {
    closeConnection();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('resolveProfileScanRoots maps each provider to its native session home', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const claude = profilesService.createProfile({ provider: 'claude', name: 'C' });
    const codex = profilesService.createProfile({ provider: 'codex', name: 'C' });
    const cursor = profilesService.createProfile({ provider: 'cursor', name: 'C' });
    const opencode = profilesService.createProfile({ provider: 'opencode', name: 'C' });

    assert.deepEqual(resolveProfileScanRoots('claude'), [
      { profileId: claude.id, home: path.join(profilesRoot, 'claude', 'c') },
    ]);
    assert.deepEqual(resolveProfileScanRoots('codex'), [
      { profileId: codex.id, home: path.join(profilesRoot, 'codex', 'c') },
    ]);
    assert.deepEqual(resolveProfileScanRoots('cursor'), [
      { profileId: cursor.id, home: path.join(profilesRoot, 'cursor', 'c', '.cursor') },
    ]);
    assert.deepEqual(resolveProfileScanRoots('opencode'), [
      { profileId: opencode.id, home: path.join(profilesRoot, 'opencode', 'c', 'data', 'opencode') },
    ]);
  });
});

test('resolveProfileRootForPath returns the owning profile for a nested artifact', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Owner' });
    const artifact = path.join(
      profilesRoot,
      'claude',
      profile.slug,
      'projects',
      'encoded',
      'sess.jsonl',
    );

    const root = resolveProfileRootForPath('claude', artifact);
    assert.equal(root?.profileId, profile.id);
  });
});

test('resolveProfileRootForPath returns null for a path under the default ~ home', async () => {
  await withProfilesEnvironment(() => {
    profilesService.createProfile({ provider: 'claude', name: 'Owner' });
    const outside = path.join(tmpdir(), 'not-a-profile', 'projects', 'sess.jsonl');
    assert.equal(resolveProfileRootForPath('claude', outside), null);
  });
});

test('resolveProfileRootForPath does not match a sibling profile via prefix', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    // "work" and "work-2" share a string prefix; the path guard must not treat
    // an artifact under "work-2" as belonging to "work".
    const work = profilesService.createProfile({ provider: 'codex', name: 'work' });
    const work2 = profilesService.createProfile({ provider: 'codex', name: 'work' });
    assert.equal(work.slug, 'work');
    assert.equal(work2.slug, 'work-2');

    const artifact = path.join(profilesRoot, 'codex', 'work-2', 'sessions', 'sess.jsonl');
    assert.equal(resolveProfileRootForPath('codex', artifact)?.profileId, work2.id);
  });
});
