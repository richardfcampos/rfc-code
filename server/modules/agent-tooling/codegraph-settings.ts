/**
 * CodeGraph enforcement, installed into every Claude profile's `settings.json`.
 *
 * The global CLAUDE.md asks sessions to prefer `codegraph_explore` over grep,
 * but prose loses to the auto-permission-mode system prompt ("search with grep
 * and find"). Measured on 2026-09-16 across 59 sessions in indexed repos: 1442
 * shell searches against 15 codegraph calls. A PreToolUse deny hook is what
 * actually redirects the model, and hooks live in the profile's settings.json
 * (read once per session), so they have to be installed per profile.
 *
 * Idempotent: entries this module owns are recognized by command and rewritten
 * in place; everything else in the file is preserved. A machine without the
 * `codegraph` binary gets nothing, so a hook that cannot run never errors on
 * every prompt.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  updateSettings,
  type HookMatcher,
  type SettingsShape,
} from '@/modules/agent-tooling/profile-settings.js';
import {
  CODEGRAPH_GUARD_SCRIPT,
  CODEGRAPH_GUARD_SCRIPT_NAME,
} from '@/modules/agent-tooling/codegraph-guard-script.js';

/** Resolves through the session's own config dir, so one entry fits every profile. */
export const CODEGRAPH_GUARD_HOOK_COMMAND =
  `bash "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/${CODEGRAPH_GUARD_SCRIPT_NAME}"`;

/** Injects structural context for the prompt before the model starts searching. */
export const CODEGRAPH_PROMPT_HOOK_COMMAND = 'codegraph prompt-hook';

/** MCP tool pattern that must never stall on a permission prompt. */
export const CODEGRAPH_PERMISSION_ALLOW = 'mcp__codegraph__*';

const GUARD_MATCHER = 'Bash';

let codegraphAvailable: boolean | null = null;

/** True when the `codegraph` CLI resolves on this machine (memoized). */
export function isCodegraphAvailable(): boolean {
  if (codegraphAvailable === null) {
    const result = spawnSync('codegraph', ['--version'], { stdio: 'ignore', timeout: 5000 });
    codegraphAvailable = !result.error && result.status === 0;
  }
  return codegraphAvailable;
}

/** Test seam: force the availability answer instead of probing PATH. */
export function setCodegraphAvailableForTests(value: boolean | null): void {
  codegraphAvailable = value;
}

function isGuardEntry(command: unknown): boolean {
  return typeof command === 'string' && command.includes(CODEGRAPH_GUARD_SCRIPT_NAME);
}

function isPromptHookEntry(command: unknown): boolean {
  return typeof command === 'string' && command.trim() === CODEGRAPH_PROMPT_HOOK_COMMAND;
}

function withoutOwnedEntries(
  groups: HookMatcher[] | undefined,
  owned: (command: unknown) => boolean,
): HookMatcher[] {
  if (!Array.isArray(groups)) {
    return [];
  }
  return groups
    .map((group) => (Array.isArray(group?.hooks)
      ? { ...group, hooks: group.hooks.filter((entry) => !owned(entry.command)) }
      : group))
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
}

function withGuardHook(settings: SettingsShape): SettingsShape {
  const preToolUse = withoutOwnedEntries(settings.hooks?.PreToolUse, isGuardEntry);
  const guard = {
    type: 'command',
    command: CODEGRAPH_GUARD_HOOK_COMMAND,
    timeout: 10,
    statusMessage: 'Checking CodeGraph index...',
  };
  // Share the Bash matcher group with RTK when it exists: Claude Code runs
  // the entries of one group in order, so the rewrite happens before the guard
  // inspects the (possibly `rtk`-prefixed) command.
  const bashGroup = preToolUse.find((group) => group.matcher === GUARD_MATCHER && Array.isArray(group.hooks));
  if (bashGroup) {
    bashGroup.hooks = [...(bashGroup.hooks ?? []), guard];
  } else {
    preToolUse.push({ matcher: GUARD_MATCHER, hooks: [guard] });
  }

  const userPromptSubmit = withoutOwnedEntries(settings.hooks?.UserPromptSubmit, isPromptHookEntry);
  userPromptSubmit.push({ hooks: [{ type: 'command', command: CODEGRAPH_PROMPT_HOOK_COMMAND }] });

  return {
    ...settings,
    hooks: { ...settings.hooks, PreToolUse: preToolUse, UserPromptSubmit: userPromptSubmit },
  };
}

function withPermissionAllow(settings: SettingsShape): SettingsShape {
  const permissions = (settings.permissions && typeof settings.permissions === 'object'
    ? settings.permissions
    : {}) as Record<string, unknown>;
  const allow = Array.isArray(permissions.allow) ? [...(permissions.allow as unknown[])] : [];
  if (!allow.includes(CODEGRAPH_PERMISSION_ALLOW)) {
    allow.push(CODEGRAPH_PERMISSION_ALLOW);
  }
  return { ...settings, permissions: { ...permissions, allow } };
}

/** Writes the guard script unless the profile already has one (local edits win). */
function ensureGuardScript(profileDir: string): void {
  const hooksDir = path.join(profileDir, 'hooks');
  const scriptPath = path.join(hooksDir, CODEGRAPH_GUARD_SCRIPT_NAME);
  if (fs.existsSync(scriptPath)) {
    return;
  }
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(scriptPath, CODEGRAPH_GUARD_SCRIPT, { mode: 0o755 });
}

/**
 * Installs the guard hook, the prompt hook, the MCP allow rule and the guard
 * script into one Claude profile. Returns false when skipped because the
 * `codegraph` CLI is not installed here.
 */
export function applyCodegraphHooks(profileDir: string): boolean {
  if (!isCodegraphAvailable()) {
    return false;
  }
  ensureGuardScript(profileDir);
  updateSettings(profileDir, (settings) => withPermissionAllow(withGuardHook(settings)));
  return true;
}
