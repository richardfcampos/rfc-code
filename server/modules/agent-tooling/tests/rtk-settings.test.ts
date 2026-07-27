import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyRtkMode,
  buildRtkHookCommand,
  normalizeRtkMode,
  readRtkMode,
  resolveSettingsPath,
} from '@/modules/agent-tooling/rtk-settings.js';

async function withProfileDir(runTest: (profileDir: string) => void | Promise<void>): Promise<void> {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'rtk-settings-'));
  try {
    await runTest(tempDirectory);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function readJson(profileDir: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(resolveSettingsPath(profileDir), 'utf8'));
}

test('normalizeRtkMode rejects values outside the supported set', () => {
  assert.equal(normalizeRtkMode('ultra-compact'), 'ultra-compact');
  assert.equal(normalizeRtkMode('ULTRA-COMPACT'), 'ultra-compact');
  assert.equal(normalizeRtkMode('ultra'), null);
  assert.equal(normalizeRtkMode(true), null);
});

test('buildRtkHookCommand only adds the flag for ultra-compact', () => {
  assert.equal(buildRtkHookCommand('normal'), 'rtk hook claude');
  assert.equal(buildRtkHookCommand('ultra-compact'), 'rtk hook claude --ultra-compact');
});

test('enabling RTK writes a Bash PreToolUse hook into a profile with no settings yet', async () => {
  await withProfileDir((profileDir) => {
    applyRtkMode(profileDir, 'normal');

    const settings = readJson(profileDir);
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash');
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, 'rtk hook claude');
    assert.equal(readRtkMode(profileDir), 'normal');
  });
});

test('switching modes replaces the hook instead of stacking duplicates', async () => {
  await withProfileDir((profileDir) => {
    applyRtkMode(profileDir, 'normal');
    applyRtkMode(profileDir, 'ultra-compact');

    const settings = readJson(profileDir);
    const entries = settings.hooks.PreToolUse.flatMap((group: any) => group.hooks);
    assert.equal(entries.length, 1, 'a stacked duplicate would rewrite the same command twice');
    assert.equal(entries[0].command, 'rtk hook claude --ultra-compact');
    assert.equal(readRtkMode(profileDir), 'ultra-compact');
  });
});

test('disabling RTK removes only its own hook and keeps foreign ones', async () => {
  await withProfileDir((profileDir) => {
    fs.writeFileSync(
      resolveSettingsPath(profileDir),
      JSON.stringify({
        env: { SOME_USER_VALUE: '1' },
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'other-tool hook' }] },
          ],
        },
      }),
    );

    applyRtkMode(profileDir, 'normal');
    applyRtkMode(profileDir, 'off');

    const settings = readJson(profileDir);
    assert.equal(readRtkMode(profileDir), 'off');
    assert.deepEqual(settings.env, { SOME_USER_VALUE: '1' }, 'unrelated settings must survive');
    const remaining = settings.hooks.PreToolUse.flatMap((group: any) => group.hooks);
    assert.deepEqual(remaining, [{ type: 'command', command: 'other-tool hook' }]);
  });
});

test('a malformed settings.json is refused rather than overwritten', async () => {
  await withProfileDir((profileDir) => {
    const settingsPath = resolveSettingsPath(profileDir);
    fs.writeFileSync(settingsPath, '{ this is not json');

    assert.throws(() => applyRtkMode(profileDir, 'normal'), /not valid JSON/);
    // The unreadable file may hold a login the user cannot easily recreate.
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ this is not json');
  });
});

test('readRtkMode reports off for a profile that has no settings file', async () => {
  await withProfileDir((profileDir) => {
    assert.equal(readRtkMode(profileDir), 'off');
  });
});
