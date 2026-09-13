import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyKitHooks,
  isAgentKitAvailable,
  linkKitContent,
  listLinkedKitContent,
  resolveAgentKitEnv,
} from '@/modules/bundled-kit/index.js';

const HOOK_SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'node "__HOOKS_DIR__/privacy-block.cjs"' }],
      },
    ],
  },
};

/**
 * Builds a fake kit plus an empty profile dir, standing in for the app's
 * agent-kit directory and one profile's config directory.
 */
async function withKit(
  runTest: (ctx: { kitRoot: string; profileDir: string }) => void | Promise<void>,
): Promise<void> {
  const previousRoot = process.env.AGENT_KIT_ROOT;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'agent-kit-'));
  const kitRoot = path.join(tempDirectory, 'agent-kit');
  const profileDir = path.join(tempDirectory, 'profile');

  fs.mkdirSync(path.join(kitRoot, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(kitRoot, 'agents', 'planner.md'), '# planner\n');
  fs.mkdirSync(path.join(kitRoot, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(kitRoot, 'rules', 'primary-workflow.md'), '# rules\n');
  fs.mkdirSync(path.join(kitRoot, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(kitRoot, 'hooks-settings.json'),
    `${JSON.stringify(HOOK_SETTINGS, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(kitRoot, 'statusline.cjs'), '// statusline\n');

  fs.mkdirSync(profileDir, { recursive: true });
  process.env.AGENT_KIT_ROOT = kitRoot;

  try {
    await runTest({ kitRoot, profileDir });
  } finally {
    if (previousRoot === undefined) {
      delete process.env.AGENT_KIT_ROOT;
    } else {
      process.env.AGENT_KIT_ROOT = previousRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function readSettings(profileDir: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(profileDir, 'settings.json'), 'utf8'));
}

test('a kit is only reported available once its hook wiring is there', async () => {
  await withKit(({ kitRoot }) => {
    assert.equal(isAgentKitAvailable(), true);
    fs.rmSync(path.join(kitRoot, 'hooks-settings.json'));
    assert.equal(isAgentKitAvailable(), false);
  });
});

test('kit content is linked into the profile, not copied', async () => {
  await withKit(({ kitRoot, profileDir }) => {
    linkKitContent(profileDir);

    const link = path.join(profileDir, 'agents', 'planner.md');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(kitRoot, 'agents', 'planner.md')));
    assert.deepEqual(listLinkedKitContent(profileDir, 'agents'), ['planner.md']);
    assert.deepEqual(listLinkedKitContent(profileDir, 'rules'), ['primary-workflow.md']);
  });
});

test("linking never replaces an agent the profile owns", async () => {
  await withKit(({ profileDir }) => {
    fs.mkdirSync(path.join(profileDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'agents', 'planner.md'), '# mine\n');

    linkKitContent(profileDir);

    assert.equal(fs.readFileSync(path.join(profileDir, 'agents', 'planner.md'), 'utf8'), '# mine\n');
    assert.deepEqual(listLinkedKitContent(profileDir, 'agents'), []);
  });
});

test('linking repairs a link left dangling by a relocated kit', async () => {
  await withKit(({ profileDir }) => {
    fs.mkdirSync(path.join(profileDir, 'agents'), { recursive: true });
    fs.symlinkSync('/nowhere/old-kit/agents/planner.md', path.join(profileDir, 'agents', 'planner.md'));

    linkKitContent(profileDir);

    assert.deepEqual(listLinkedKitContent(profileDir, 'agents'), ['planner.md']);
  });
});

test('hooks are registered from the bundled wiring with the real path', async () => {
  await withKit(({ kitRoot, profileDir }) => {
    applyKitHooks(profileDir, true);

    const command = readSettings(profileDir).hooks.PreToolUse[0].hooks[0].command;
    assert.equal(command.includes('__HOOKS_DIR__'), false);
    assert.equal(command.includes(path.join(kitRoot, 'hooks')), true);
  });
});

test('re-registering converges on one copy instead of stacking duplicates', async () => {
  await withKit(({ profileDir }) => {
    applyKitHooks(profileDir, true);
    applyKitHooks(profileDir, true);

    assert.equal(readSettings(profileDir).hooks.PreToolUse.length, 1);
  });
});

test('hooks the profile registered itself survive install and removal', async () => {
  await withKit(({ profileDir }) => {
    fs.writeFileSync(
      path.join(profileDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }],
        },
      }),
    );

    applyKitHooks(profileDir, true);
    assert.equal(readSettings(profileDir).hooks.PreToolUse.length, 2);

    applyKitHooks(profileDir, false);
    const groups = readSettings(profileDir).hooks.PreToolUse;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].hooks[0].command, 'rtk hook claude');
  });
});

test('the status line is claimed only when the profile has none', async () => {
  await withKit(({ profileDir }) => {
    applyKitHooks(profileDir, true);
    assert.match(readSettings(profileDir).statusLine.command, /statusline\.cjs/);

    // Removing the kit gives the slot back, and a status line of the user's own
    // is never touched by either direction.
    applyKitHooks(profileDir, false);
    assert.equal(readSettings(profileDir).statusLine, undefined);

    fs.writeFileSync(
      path.join(profileDir, 'settings.json'),
      JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }),
    );
    applyKitHooks(profileDir, true);
    assert.equal(readSettings(profileDir).statusLine.command, 'mine');
  });
});

test('the hook env points the kit at the profile, not the invoking user', async () => {
  await withKit(({ profileDir }) => {
    assert.deepEqual(resolveAgentKitEnv(profileDir), {
      AGENTKIT_CLAUDE_HOME: profileDir,
      AGENTKIT_HOME: path.join(profileDir, '.agentkit'),
      CK_HOOK_LOG_DIR: path.join(profileDir, '.agentkit', 'hook-logs'),
    });
  });
});
