import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildCodexClientOptions } from './codex-client-options.js';
import { closeConnection, initializeDatabase } from './modules/database/index.js';
import { profilesService } from './modules/profiles/index.js';

async function withProfilesEnvironment(runTest) {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
  };
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'codex-profile-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempDirectory, 'profiles');
  await initializeDatabase();

  try {
    await runTest(path.join(tempDirectory, 'profiles'));
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

// T7 Done-when: two concurrent Codex profiles never share CODEX_HOME.
test('buildCodexClientOptions gives each Codex profile an isolated CODEX_HOME', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const a = profilesService.createProfile({ provider: 'codex', name: 'Account A' });
    const b = profilesService.createProfile({ provider: 'codex', name: 'Account B' });

    const optionsA = buildCodexClientOptions(a.id);
    const optionsB = buildCodexClientOptions(b.id);

    assert.equal(optionsA.env.CODEX_HOME, path.join(profilesRoot, 'codex', a.slug));
    assert.equal(optionsB.env.CODEX_HOME, path.join(profilesRoot, 'codex', b.slug));
    assert.notEqual(optionsA.env.CODEX_HOME, optionsB.env.CODEX_HOME);
  });
});

// The SDK does not inherit process.env when env is provided, so the full host
// environment must be carried across — otherwise the CLI loses PATH/HOME/etc.
test('buildCodexClientOptions carries the full host environment alongside CODEX_HOME', async () => {
  await withProfilesEnvironment(() => {
    const profile = profilesService.createProfile({ provider: 'codex', name: 'Env' });
    const options = buildCodexClientOptions(profile.id);
    assert.equal(options.env.PATH, process.env.PATH);
  });
});

// Retrocompat: with no profile, `new Codex(undefined)` keeps inheriting process.env.
test('buildCodexClientOptions returns undefined when there is no profile', async () => {
  await withProfilesEnvironment(() => {
    assert.equal(buildCodexClientOptions(undefined), undefined);
    assert.equal(buildCodexClientOptions(null), undefined);
  });
});

// A working directory hands the session the shared project memory; without a
// Claude profile to own it, that is Claude Code's default config dir.
test('buildCodexClientOptions points RFC_MEMORY_DIR at the shared memory for the working directory', async () => {
  await withProfilesEnvironment(() => {
    const options = buildCodexClientOptions(null, '/srv/code/app-worktrees/wt.x');
    assert.equal(
      options.env.RFC_MEMORY_DIR,
      path.join(homedir(), '.claude', 'projects', '-srv-code-app-worktrees-wt-x', 'memory'),
    );
    assert.equal(options.env.PATH, process.env.PATH);
  });
});

test('buildCodexClientOptions uses the default Claude profile memory when one is set', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const claude = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    profilesService.setDefaultProfile(claude.id, true);
    const codex = profilesService.createProfile({ provider: 'codex', name: 'Codex' });

    const options = buildCodexClientOptions(codex.id, '/srv/code/app');

    assert.equal(options.env.CODEX_HOME, path.join(profilesRoot, 'codex', codex.slug));
    assert.equal(
      options.env.RFC_MEMORY_DIR,
      path.join(profilesRoot, 'claude', claude.slug, 'projects', '-srv-code-app', 'memory'),
    );
  });
});
