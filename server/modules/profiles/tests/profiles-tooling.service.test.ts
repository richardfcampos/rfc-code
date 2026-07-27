import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  sessionsDb,
} from '@/modules/database/index.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';
import {
  CAVEMAN_PLUGIN_KEY,
  isCavemanPluginEnabled,
  readRtkMode,
} from '@/modules/agent-tooling/index.js';

/** Ephemeral DB + PROFILES_ROOT, mirroring profiles.service.test.ts. */
async function withProfilesEnvironment(
  runTest: (profilesRoot: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousProfilesRoot = process.env.PROFILES_ROOT;
  const previousPluginPath = process.env.CAVEMAN_PLUGIN_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'profiles-tooling-'));
  const profilesRoot = path.join(tempDirectory, 'profiles');

  // Stand in for the copy the image installs, so setting a level exercises the
  // real registration path instead of the "plugin missing" guard.
  const pluginPath = path.join(tempDirectory, 'caveman-plugin');
  fs.mkdirSync(path.join(pluginPath, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginPath, '.claude-plugin', 'plugin.json'), '{"name":"caveman"}');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = profilesRoot;
  process.env.CAVEMAN_PLUGIN_PATH = pluginPath;
  await initializeDatabase();

  try {
    await runTest(profilesRoot);
  } finally {
    closeConnection();
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('PROFILES_ROOT', previousProfilesRoot);
    restoreEnv('CAVEMAN_PLUGIN_PATH', previousPluginPath);
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

test('a new profile starts with both tooling levels unconfigured', async () => {
  await withProfilesEnvironment(() => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });

    assert.equal(profile.cavemanMode, null);
    assert.equal(profile.rtkMode, null);
  });
});

test('setting one tooling level leaves the other untouched', async () => {
  await withProfilesEnvironment(() => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });

    profilesService.updateToolingModes(profile.id, { rtkMode: 'normal' });
    const after = profilesService.updateToolingModes(profile.id, { cavemanMode: 'lite' });

    assert.equal(after.rtkMode, 'normal');
    assert.equal(after.cavemanMode, 'lite');
  });
});

test('enabling RTK writes the hook into the profile config dir', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });
    const profileDir = path.join(profilesRoot, 'claude', profile.slug);

    profilesService.updateToolingModes(profile.id, { rtkMode: 'ultra-compact' });
    assert.equal(readRtkMode(profileDir), 'ultra-compact');

    profilesService.updateToolingModes(profile.id, { rtkMode: null });
    assert.equal(readRtkMode(profileDir), 'off');
  });
});

test('two profiles get independent RTK hooks in their own config dirs', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const a = profilesService.createProfile({ provider: 'claude', name: 'A' });
    const b = profilesService.createProfile({ provider: 'claude', name: 'B' });

    profilesService.updateToolingModes(a.id, { rtkMode: 'normal' });

    assert.equal(readRtkMode(path.join(profilesRoot, 'claude', a.slug)), 'normal');
    assert.equal(readRtkMode(path.join(profilesRoot, 'claude', b.slug)), 'off');
  });
});

test('a bad mode is rejected and nothing is written to disk', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });
    const settingsPath = path.join(profilesRoot, 'claude', profile.slug, 'settings.json');

    assert.throws(
      () => profilesService.updateToolingModes(profile.id, { rtkMode: 'turbo' }),
      /Unsupported RTK mode/,
    );
    assert.equal(fs.existsSync(settingsPath), false);
    assert.equal(profilesService.getProfile(profile.id).rtkMode, null);
  });
});

test('tooling is refused for providers where the plugins do not apply', async () => {
  await withProfilesEnvironment(() => {
    const codex = profilesService.createProfile({ provider: 'codex', name: 'Codex' });

    assert.throws(
      () => profilesService.updateToolingModes(codex.id, { cavemanMode: 'full' }),
      /only available for claude/,
    );
  });
});

test('an unconfigured session injects nothing, leaving the plugin config alone', async () => {
  await withProfilesEnvironment(() => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });

    assert.deepEqual(profilesService.resolveToolingEnv(profile.id, null), {});
    assert.deepEqual(profilesService.resolveToolingEnv(null, null), {});
  });
});

test('the profile default reaches a session that has no override', async () => {
  await withProfilesEnvironment(() => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });
    profilesService.updateToolingModes(profile.id, { cavemanMode: 'ultra' });

    assert.deepEqual(profilesService.resolveToolingEnv(profile.id, null), {
      CAVEMAN_DEFAULT_MODE: 'ultra',
    });
  });
});

test('a session override wins over the profile default, including off', async () => {
  await withProfilesEnvironment(() => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });
    profilesService.updateToolingModes(profile.id, { cavemanMode: 'ultra' });

    assert.deepEqual(profilesService.resolveToolingEnv(profile.id, 'off'), {
      CAVEMAN_DEFAULT_MODE: 'off',
    });
  });
});

test('a non-claude profile never gets tooling env, even if a mode is passed', async () => {
  await withProfilesEnvironment(() => {
    const codex = profilesService.createProfile({ provider: 'codex', name: 'Codex' });

    assert.deepEqual(profilesService.resolveToolingEnv(codex.id, 'ultra'), {});
  });
});

test('clearing a session override differs from setting it to off', async () => {
  await withProfilesEnvironment(() => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });
    profilesService.updateToolingModes(profile.id, { cavemanMode: 'lite' });
    sessionsDb.createAppSession('s1', 'claude', tmpdir(), profile.id);

    profilesService.updateSessionCavemanMode('s1', 'off');
    assert.equal(sessionsDb.getSessionById('s1')?.caveman_mode, 'off');

    // Cleared means "follow the profile" and keeps tracking later changes,
    // which is materially different from being pinned to off.
    profilesService.updateSessionCavemanMode('s1', null);
    const cleared = sessionsDb.getSessionById('s1');
    assert.equal(cleared?.caveman_mode, null);
    assert.deepEqual(profilesService.resolveToolingEnv(profile.id, cleared?.caveman_mode), {
      CAVEMAN_DEFAULT_MODE: 'lite',
    });
  });
});

test('setting a level also enables the plugin that reads it', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });
    const profileDir = path.join(profilesRoot, 'claude', profile.slug);

    // Without this the env var would be injected into a session where nothing
    // reads it — a switch that looks like it works and changes nothing.
    profilesService.updateToolingModes(profile.id, { cavemanMode: 'full' });
    assert.equal(isCavemanPluginEnabled(profileDir), true);

    const registry = JSON.parse(
      fs.readFileSync(path.join(profileDir, 'plugins', 'installed_plugins.json'), 'utf8'),
    );
    assert.equal(
      registry.plugins[CAVEMAN_PLUGIN_KEY][0].installPath,
      process.env.CAVEMAN_PLUGIN_PATH,
    );

    profilesService.updateToolingModes(profile.id, { cavemanMode: null });
    assert.equal(isCavemanPluginEnabled(profileDir), false);
  });
});

test('off keeps the plugin enabled so a session can override back up', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });
    const profileDir = path.join(profilesRoot, 'claude', profile.slug);

    profilesService.updateToolingModes(profile.id, { cavemanMode: 'off' });
    assert.equal(isCavemanPluginEnabled(profileDir), true);
  });
});

test('RTK and caveman coexist in one settings.json without clobbering each other', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'A' });
    const profileDir = path.join(profilesRoot, 'claude', profile.slug);

    profilesService.updateToolingModes(profile.id, { rtkMode: 'normal' });
    profilesService.updateToolingModes(profile.id, { cavemanMode: 'lite' });

    assert.equal(readRtkMode(profileDir), 'normal', 'enabling caveman must not drop the RTK hook');
    assert.equal(isCavemanPluginEnabled(profileDir), true);
  });
});

test('a session override on an unknown session is a 404, not a silent no-op', async () => {
  await withProfilesEnvironment(() => {
    assert.throws(
      () => profilesService.updateSessionCavemanMode('nope', 'full'),
      /was not found/,
    );
  });
});
