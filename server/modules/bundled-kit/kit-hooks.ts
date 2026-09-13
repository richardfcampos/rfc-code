/**
 * Registers the agent kit's hooks and status line in a profile's settings.
 *
 * The kit ships its hook wiring as `hooks-settings.json`, a copy of what its
 * own installer would write with the install path left as a token. Reading it
 * here instead of hard-coding the entries means an updated kit that adds or
 * drops a hook needs no change on this side.
 *
 * Writes are surgical: an entry is recognized as the kit's by the hook
 * directory its command runs out of, so only those are added or removed and
 * anything else in `settings.json` is preserved. Registration is a rewrite
 * rather than an append — the kit's entries are removed first, so repeated
 * calls converge on one copy instead of stacking duplicates that would each
 * fire on the same tool call.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getAgentKitRoot, resolveKitHooksDir } from '@/modules/bundled-kit/bundled-kit.js';
import {
  updateSettings,
  type HookEntry,
  type HookMatcher,
  type SettingsShape,
} from '@/modules/agent-tooling/index.js';

/** Placeholder the bundled wiring carries in place of an install path. */
const HOOKS_DIR_TOKEN = '__HOOKS_DIR__';

type HookSettings = { hooks?: Record<string, HookMatcher[]> };

/** Reads the bundled wiring with the token resolved to this install's path. */
function readKitHookGroups(): Record<string, HookMatcher[]> {
  const manifestPath = path.join(getAgentKitRoot(), 'hooks-settings.json');

  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    // No kit in this checkout: nothing to register, and nothing to repair.
    return {};
  }

  const resolved = raw.replaceAll(HOOKS_DIR_TOKEN, resolveKitHooksDir());
  const parsed = JSON.parse(resolved) as HookSettings;
  return parsed.hooks ?? {};
}

/** True when a hook entry runs a script out of the bundled hooks directory. */
function isKitHookEntry(entry: HookEntry): boolean {
  return typeof entry.command === 'string' && entry.command.includes(resolveKitHooksDir());
}

/** Drops every kit-owned entry, and any matcher group left empty by that. */
function withoutKitHooks(settings: SettingsShape): SettingsShape {
  if (!settings.hooks) {
    return settings;
  }

  const hooks: Record<string, HookMatcher[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }

    const cleaned = groups
      .map((group) =>
        Array.isArray(group?.hooks)
          ? { ...group, hooks: group.hooks.filter((entry) => !isKitHookEntry(entry)) }
          : group,
      )
      .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);

    // Drop the event entirely rather than leaving an empty array behind, so a
    // profile that never had hooks looks untouched after the kit is removed.
    if (cleaned.length > 0) {
      hooks[event] = cleaned;
    }
  }

  const next: SettingsShape = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  }
  return next;
}

/** Appends the bundled groups onto whatever the profile already registers. */
function withKitHooks(
  settings: SettingsShape,
  kitGroups: Record<string, HookMatcher[]>,
): SettingsShape {
  const hooks: Record<string, HookMatcher[]> = { ...settings.hooks };

  for (const [event, groups] of Object.entries(kitGroups)) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...existing, ...groups];
  }

  return { ...settings, hooks };
}

/**
 * Installs the kit's hooks into a profile, and its status line if free.
 *
 * The status line is a single slot rather than a list, so it is only claimed
 * when the profile has none: replacing one the user configured would silently
 * swap out something they can see on every turn.
 */
export function applyKitHooks(profileDir: string, enabled: boolean): void {
  const kitGroups = enabled ? readKitHookGroups() : {};
  const statusLineCommand = `node ${JSON.stringify(path.join(getAgentKitRoot(), 'statusline.cjs'))}`;

  updateSettings(profileDir, (settings) => {
    const base = withoutKitHooks(settings);
    if (!enabled) {
      return isKitStatusLine(base, statusLineCommand) ? withoutStatusLine(base) : base;
    }

    const next = withKitHooks(base, kitGroups);
    if (base.statusLine === undefined) {
      return { ...next, statusLine: { type: 'command', command: statusLineCommand } };
    }
    return next;
  });
}

function isKitStatusLine(settings: SettingsShape, command: string): boolean {
  const statusLine = settings.statusLine as { command?: string } | undefined;
  return statusLine?.command === command;
}

function withoutStatusLine(settings: SettingsShape): SettingsShape {
  const next = { ...settings };
  delete next.statusLine;
  return next;
}
