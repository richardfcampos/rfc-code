import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyCodegraphHooks,
  CODEGRAPH_GUARD_HOOK_COMMAND,
  CODEGRAPH_PERMISSION_ALLOW,
  CODEGRAPH_PROMPT_HOOK_COMMAND,
  setCodegraphAvailableForTests,
} from '@/modules/agent-tooling/codegraph-settings.js';
import { applyRtkMode } from '@/modules/agent-tooling/rtk-settings.js';
import { readSettings, resolveSettingsPath } from '@/modules/agent-tooling/profile-settings.js';

function makeProfileDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-settings-'));
}

function readHookCommands(profileDir: string, event: string): string[] {
  const settings = readSettings(resolveSettingsPath(profileDir));
  return (settings.hooks?.[event] ?? [])
    .flatMap((group) => group.hooks ?? [])
    .map((entry) => String(entry.command));
}

test('installs guard, prompt hook, allow rule and script into an empty profile', () => {
  setCodegraphAvailableForTests(true);
  const profileDir = makeProfileDir();

  assert.equal(applyCodegraphHooks(profileDir), true);

  assert.deepEqual(readHookCommands(profileDir, 'PreToolUse'), [CODEGRAPH_GUARD_HOOK_COMMAND]);
  assert.deepEqual(readHookCommands(profileDir, 'UserPromptSubmit'), [CODEGRAPH_PROMPT_HOOK_COMMAND]);
  const settings = readSettings(resolveSettingsPath(profileDir));
  assert.deepEqual((settings.permissions as { allow: string[] }).allow, [CODEGRAPH_PERMISSION_ALLOW]);
  const script = path.join(profileDir, 'hooks', 'codegraph-guard.sh');
  assert.ok(fs.statSync(script).mode & 0o100, 'guard script is executable');
  assert.match(fs.readFileSync(script, 'utf8'), /permissionDecision:"deny"/);
});

test('is idempotent and shares the Bash group with RTK without touching its entry', () => {
  setCodegraphAvailableForTests(true);
  const profileDir = makeProfileDir();
  applyRtkMode(profileDir, 'normal');
  fs.writeFileSync(
    resolveSettingsPath(profileDir),
    JSON.stringify({
      ...readSettings(resolveSettingsPath(profileDir)),
      theme: 'dark',
      permissions: { allow: ['Bash(git status*)'], deny: ['Bash(rm -rf*)'] },
    }),
  );

  applyCodegraphHooks(profileDir);
  applyCodegraphHooks(profileDir);

  const settings = readSettings(resolveSettingsPath(profileDir));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.hooks?.PreToolUse?.length, 1, 'one Bash matcher group');
  assert.deepEqual(readHookCommands(profileDir, 'PreToolUse'), ['rtk hook claude', CODEGRAPH_GUARD_HOOK_COMMAND]);
  assert.deepEqual(readHookCommands(profileDir, 'UserPromptSubmit'), [CODEGRAPH_PROMPT_HOOK_COMMAND]);
  assert.deepEqual(settings.permissions, {
    allow: ['Bash(git status*)', CODEGRAPH_PERMISSION_ALLOW],
    deny: ['Bash(rm -rf*)'],
  });
});

test('keeps a guard script the user already customized', () => {
  setCodegraphAvailableForTests(true);
  const profileDir = makeProfileDir();
  const script = path.join(profileDir, 'hooks', 'codegraph-guard.sh');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '#!/bin/sh\nexit 0\n');

  applyCodegraphHooks(profileDir);

  assert.equal(fs.readFileSync(script, 'utf8'), '#!/bin/sh\nexit 0\n');
});

test('does nothing when the codegraph CLI is missing', () => {
  setCodegraphAvailableForTests(false);
  const profileDir = makeProfileDir();

  assert.equal(applyCodegraphHooks(profileDir), false);

  assert.equal(fs.existsSync(resolveSettingsPath(profileDir)), false);
  setCodegraphAvailableForTests(null);
});
