/**
 * Repairs machine-specific absolute paths in a profile's plugin config files.
 *
 * The Claude CLI records plugin install locations as absolute paths inside
 * `plugins/installed_plugins.json` and `plugins/known_marketplaces.json`.
 * Moving the data directory to another machine (different home directory, or
 * out of a container) leaves those paths pointing at the old filesystem, so
 * every plugin silently stops loading even though its payload moved along.
 *
 * Repair is conservative: a string is only rewritten when it is an absolute
 * path that does not exist here AND one of the candidate translations does.
 * Anything else — working paths, non-path strings — is left untouched.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_CONFIG_FILES = ['installed_plugins.json', 'known_marketplaces.json'];

type RemapContext = {
  profileDir: string;
  homeDir: string;
};

/**
 * Translates a stale absolute path from another machine to its local
 * equivalent, or null when no translation lands on something that exists.
 *
 * Two translations cover the ways these paths move:
 *  - a foreign home prefix (`/Users/<name>/…`, `/home/<name>/…`) swapped for
 *    the local home — plugin payloads installed under the user's home;
 *  - everything up to the `profiles/` segment swapped for the local profiles
 *    root — marketplace clones stored inside the profile itself.
 */
export function remapStalePath(stalePath: string, context: RemapContext): string | null {
  if (!path.isAbsolute(stalePath) || fs.existsSync(stalePath)) {
    return null;
  }

  const candidates: string[] = [];

  const homeMatch = stalePath.match(/^\/(?:Users|home)\/[^/]+\/(.+)$/);
  if (homeMatch) {
    candidates.push(path.join(context.homeDir, homeMatch[1]));
  }

  const profilesMarker = '/profiles/';
  const markerIndex = stalePath.indexOf(profilesMarker);
  if (markerIndex !== -1) {
    // profileDir is <profilesRoot>/<provider>/<slug>.
    const profilesRoot = path.dirname(path.dirname(context.profileDir));
    candidates.push(
      path.join(profilesRoot, stalePath.slice(markerIndex + profilesMarker.length)),
    );
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Rewrites stale paths in any string field, recursing through the config. */
function repairValue(value: unknown, context: RemapContext): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const remapped = remapStalePath(value, context);
    return remapped ? { value: remapped, changed: true } : { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const repaired = value.map((item) => {
      const result = repairValue(item, context);
      changed ||= result.changed;
      return result.value;
    });
    return { value: repaired, changed };
  }

  if (value && typeof value === 'object') {
    let changed = false;
    const repaired: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = repairValue(item, context);
      changed ||= result.changed;
      repaired[key] = result.value;
    }
    return { value: repaired, changed };
  }

  return { value, changed: false };
}

/**
 * Repairs both plugin config files of one profile in place. Best effort: a
 * missing or malformed file is skipped, never an error — most profiles have
 * no plugins at all.
 */
export function repairPluginConfigPaths(profileDir: string): void {
  const context: RemapContext = { profileDir, homeDir: os.homedir() };

  for (const fileName of PLUGIN_CONFIG_FILES) {
    const filePath = path.join(profileDir, 'plugins', fileName);

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }

    const result = repairValue(parsed, context);
    if (result.changed) {
      fs.writeFileSync(filePath, `${JSON.stringify(result.value, null, 2)}\n`);
    }
  }
}
