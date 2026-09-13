/**
 * Exposes the agent kit bundled with the app inside each profile's config dir.
 *
 * The skills half of the kit is handled by `bundled-skills`, which can toggle
 * one skill at a time. This module covers the rest of what the kit ships —
 * subagents, rule files, output styles, hooks and a status line — none of which
 * Claude Code discovers unless it sits under the config dir the session runs
 * against.
 *
 * As with the skills, each entry is a symlink into the one read-only copy that
 * ships with the app rather than a per-profile copy, so an update lands in every
 * profile at once. Linking file by file (instead of the whole directory) leaves
 * room for a profile to keep agents and rules of its own alongside the bundled
 * ones, and is what makes the non-clobbering rules below expressible.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Subdirectories linked verbatim from the bundle into a profile. */
export const KIT_CONTENT_DIRS = ['agents', 'rules', 'output-styles'] as const;

export function getAgentKitRoot(): string {
  return process.env.AGENT_KIT_ROOT || '/opt/rfc-code/agent-kit';
}

/** Absolute path to the hook scripts, the value hook commands are built from. */
export function resolveKitHooksDir(): string {
  return path.join(getAgentKitRoot(), 'hooks');
}

export function isAgentKitAvailable(): boolean {
  return fs.existsSync(path.join(getAgentKitRoot(), 'hooks-settings.json'));
}

/**
 * Environment the kit's hooks read to stay inside one profile.
 *
 * The hook scripts default to `~/.claude` and `~/.agentkit` for the session
 * state they carry between turns. Left at those defaults every profile would
 * write its state into the same two directories, which is exactly the leak
 * between accounts the per-profile config dir exists to prevent.
 *
 * Their log directory defaults to the bundle itself, which is worse still: it
 * is one directory shared by every profile, and it is inside the app's own
 * install rather than its data.
 */
export function resolveAgentKitEnv(profileDir: string): Record<string, string> {
  const kitState = path.join(profileDir, '.agentkit');
  return {
    AGENTKIT_CLAUDE_HOME: profileDir,
    AGENTKIT_HOME: kitState,
    CK_HOOK_LOG_DIR: path.join(kitState, 'hook-logs'),
  };
}

/**
 * Links one bundled file into a profile. Idempotent, and never clobbers.
 *
 * A real file at the target is one the user put there themselves, and a symlink
 * pointing outside the bundle is a copy they chose deliberately; both win over
 * the bundled version. Our own links are replaced rather than kept, so a stale
 * target left by an older version is repaired instead of left dangling.
 */
function linkBundledFile(source: string, link: string): void {
  const existing = lstatOrNull(link);
  if (existing && !existing.isSymbolicLink()) {
    return;
  }
  if (existing?.isSymbolicLink()) {
    if (!pointsIntoKit(link)) {
      return;
    }
    fs.unlinkSync(link);
  }

  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(source, link);
}

/** True when a link resolves inside the bundle shipped with the app. */
function resolvesIntoKit(linkPath: string): boolean {
  try {
    const target = fs.realpathSync(linkPath);
    const root = fs.realpathSync(getAgentKitRoot());
    return target === root || target.startsWith(root + path.sep);
  } catch {
    return false;
  }
}

/** Whether replacing this link is ours to do. */
function pointsIntoKit(linkPath: string): boolean {
  // A dangling link points nowhere, so it cannot be a copy the user chose: it
  // is either ours from an older layout or a leftover, and either way replacing
  // it is what repairs the profile.
  return resolvesIntoKit(linkPath) || !fs.existsSync(linkPath);
}

/**
 * Links the kit's agents, rules and output styles into a profile.
 *
 * Missing bundle directories are not an error: the app can run against a
 * checkout that has no kit, and that has to degrade to "no bundled agents"
 * rather than fail a profile's creation.
 */
export function linkKitContent(profileDir: string): void {
  const root = getAgentKitRoot();

  for (const dir of KIT_CONTENT_DIRS) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      linkBundledFile(path.join(root, dir, entry.name), path.join(profileDir, dir, entry.name));
    }
  }
}

/** Names currently linked into a profile out of one kit directory. */
export function listLinkedKitContent(profileDir: string, dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(profileDir, dir), { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isSymbolicLink())
    .filter((entry) => resolvesIntoKit(path.join(profileDir, dir, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}
