import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  remapStalePath,
  repairPluginConfigPaths,
} from '@/modules/profiles/profile-plugin-path-repair.js';

/** A fake data root with one profile, its plugins dir, and a fake home. */
async function withProfile(
  runTest: (ctx: { root: string; profileDir: string; homeDir: string }) => void | Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-path-repair-'));
  const profileDir = path.join(root, 'data', 'profiles', 'claude', 'main');
  const homeDir = path.join(root, 'new-home');
  fs.mkdirSync(path.join(profileDir, 'plugins'), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  try {
    await runTest({ root, profileDir, homeDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a foreign home prefix is swapped for the local home', async () => {
  await withProfile(({ profileDir, homeDir }) => {
    fs.mkdirSync(path.join(homeDir, '.rfc-code', 'some-plugin'), { recursive: true });

    const remapped = remapStalePath('/Users/old-name/.rfc-code/some-plugin', {
      profileDir,
      homeDir,
    });

    assert.equal(remapped, path.join(homeDir, '.rfc-code', 'some-plugin'));
  });
});

test('a path into the profiles tree is remapped onto the local profiles root', async () => {
  await withProfile(({ profileDir, homeDir }) => {
    const marketplace = path.join(profileDir, 'plugins', 'marketplaces', 'acme');
    fs.mkdirSync(marketplace, { recursive: true });

    // Container-style path with no home prefix at all.
    const remapped = remapStalePath('/data/profiles/claude/main/plugins/marketplaces/acme', {
      profileDir,
      homeDir,
    });

    assert.equal(remapped, marketplace);
  });
});

test('working paths and unresolvable paths are left alone', async () => {
  await withProfile(({ root, profileDir, homeDir }) => {
    const context = { profileDir, homeDir };

    // Exists here: not stale, nothing to do.
    assert.equal(remapStalePath(root, context), null);
    // Stale, but nothing local matches either translation.
    assert.equal(remapStalePath('/Users/old-name/nowhere/at-all', context), null);
    // Not an absolute path.
    assert.equal(remapStalePath('caveman@caveman', context), null);
  });
});

test('repair rewrites only the stale strings in the plugin config files', async () => {
  await withProfile(({ profileDir }) => {
    // The file-level repair runs against the real home, so it is exercised
    // through the profiles-root rule, which is fully under the test's control.
    const marketplacesPath = path.join(profileDir, 'plugins', 'known_marketplaces.json');
    const marketplace = path.join(profileDir, 'plugins', 'marketplaces', 'acme');
    fs.mkdirSync(marketplace, { recursive: true });
    fs.writeFileSync(
      marketplacesPath,
      JSON.stringify({
        acme: {
          source: { source: 'github', repo: 'acme/acme' },
          installLocation: '/data/profiles/claude/main/plugins/marketplaces/acme',
        },
      }),
    );

    repairPluginConfigPaths(profileDir);

    const marketplaces = JSON.parse(fs.readFileSync(marketplacesPath, 'utf8'));
    assert.equal(marketplaces.acme.installLocation, marketplace);
    assert.equal(marketplaces.acme.source.repo, 'acme/acme');
  });
});

test('a missing or malformed config file is skipped, not an error', async () => {
  await withProfile(({ profileDir }) => {
    fs.writeFileSync(path.join(profileDir, 'plugins', 'known_marketplaces.json'), 'not json');

    assert.doesNotThrow(() => repairPluginConfigPaths(profileDir));
  });
});
