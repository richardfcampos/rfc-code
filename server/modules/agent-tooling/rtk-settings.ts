/**
 * RTK command-rewriting hook, toggled per profile.
 *
 * RTK installs itself as a Claude Code `PreToolUse` hook that rewrites Bash
 * commands into their token-optimized `rtk ...` equivalents. The hook lives in
 * the profile's `settings.json`, which Claude Code reads once at session start
 * and which every session of that profile shares — so, unlike the caveman mode,
 * this cannot be scoped to a single session without putting a wrapper script of
 * our own between Claude Code and a third-party binary. It is a profile-level
 * switch instead.
 *
 * Writes are surgical: only hook entries this module recognizes as RTK's are
 * added or removed, and everything else in the file is preserved byte-for-byte
 * in value. A `settings.json` that does not parse is an error, never something
 * to overwrite — it may hold a login the user cannot easily recreate.
 */

import {
  readSettings,
  resolveSettingsPath,
  updateSettings,
  type HookEntry,
  type HookMatcher,
  type SettingsShape,
} from '@/modules/agent-tooling/profile-settings.js';

export { resolveSettingsPath };

/** How aggressively the RTK hook compresses tool output. */
export const RTK_MODES = ['off', 'normal', 'ultra-compact'] as const;

export type RtkMode = (typeof RTK_MODES)[number];

export const DEFAULT_RTK_MODE: RtkMode = 'off';

/** Base command; `rtk hook claude` reads the tool call as JSON on stdin. */
const RTK_HOOK_COMMAND = 'rtk hook claude';

/** Matcher RTK registers against — it only rewrites Bash tool calls. */
const RTK_HOOK_MATCHER = 'Bash';

export function isRtkMode(value: unknown): value is RtkMode {
  return typeof value === 'string' && (RTK_MODES as readonly string[]).includes(value);
}

export function normalizeRtkMode(value: unknown): RtkMode | null {
  if (value === null || value === undefined) {
    return null;
  }
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isRtkMode(candidate) ? candidate : null;
}

/** Command line the hook runs for a given mode. */
export function buildRtkHookCommand(mode: RtkMode): string {
  return mode === 'ultra-compact' ? `${RTK_HOOK_COMMAND} --ultra-compact` : RTK_HOOK_COMMAND;
}

/** True when a hook entry is one this module owns. */
function isRtkHookEntry(entry: HookEntry): boolean {
  return typeof entry.command === 'string' && entry.command.trim().startsWith(RTK_HOOK_COMMAND);
}

/** Drops every RTK-owned entry, and any matcher group left empty by that. */
function withoutRtkHooks(settings: SettingsShape): SettingsShape {
  const preToolUse = settings.hooks?.PreToolUse;
  if (!Array.isArray(preToolUse)) {
    return settings;
  }

  const cleaned = preToolUse
    .map((group) => {
      if (!Array.isArray(group?.hooks)) {
        return group;
      }
      return { ...group, hooks: group.hooks.filter((entry) => !isRtkHookEntry(entry)) };
    })
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);

  const hooks: Record<string, HookMatcher[]> = { ...settings.hooks };
  // Drop the key entirely rather than leaving an empty array behind, so a
  // profile that never had hooks looks untouched after toggling RTK off.
  if (cleaned.length === 0) {
    delete hooks.PreToolUse;
  } else {
    hooks.PreToolUse = cleaned;
  }

  const next: SettingsShape = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  }
  return next;
}

/**
 * Applies `mode` to a profile's settings.
 *
 * Rewrites rather than appends: the RTK entry is removed first, so repeated
 * calls converge on exactly one hook instead of stacking duplicates that would
 * each rewrite the same command.
 */
export function applyRtkMode(profileDir: string, mode: RtkMode): void {
  updateSettings(profileDir, (settings) => {
    const base = withoutRtkHooks(settings);
    if (mode === 'off') {
      return base;
    }

    const hooks = { ...base.hooks };
    const preToolUse = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
    preToolUse.push({
      matcher: RTK_HOOK_MATCHER,
      hooks: [{ type: 'command', command: buildRtkHookCommand(mode) }],
    });

    return { ...base, hooks: { ...hooks, PreToolUse: preToolUse } };
  });
}

/**
 * Reads back the mode currently installed on disk.
 *
 * The stored profile column is the intent; this is the ground truth, and the two
 * can drift if someone edits `settings.json` by hand or runs `rtk init`.
 */
export function readRtkMode(profileDir: string): RtkMode {
  const settings = readSettings(resolveSettingsPath(profileDir));
  const entries = (settings.hooks?.PreToolUse ?? [])
    .flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []))
    .filter(isRtkHookEntry);

  if (entries.length === 0) {
    return 'off';
  }
  return entries.some((entry) => entry.command?.includes('--ultra-compact'))
    ? 'ultra-compact'
    : 'normal';
}
