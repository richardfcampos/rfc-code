/**
 * Rules for healing a profile's skill links after the bundle changes.
 *
 * A profile records its selection as one symlink per skill, so renaming or
 * dropping a skill in the bundle leaves links pointing at paths that no longer
 * exist — which Claude Code reports as broken skills on every session start.
 * These two predicates decide what to do with such a link; `repairSkillLinks`
 * applies them.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * The bundle name a dangling link should follow, if the skill was renamed.
 *
 * The kit these skills come from prefixes every name (`cook` became `ak-cook`,
 * and the `ck-` prefix an earlier release used to avoid collisions became `ak-`
 * as well). Deriving the new name rather than carrying a table means a later
 * renaming wave needs no second migration.
 */
export function renamedBundleName(name: string, bundledNames: ReadonlySet<string>): string | null {
  const candidate = `ak-${name.replace(/^ck-/, '')}`;
  return bundledNames.has(candidate) ? candidate : null;
}

/**
 * Whether a dangling link was one of ours, by reading its recorded target.
 *
 * `realpath` cannot answer this once the target is gone, and the answer decides
 * whether the link is ours to delete — a dangling link into a directory the
 * user mounted themselves has to survive that mount being away.
 */
export function pointedIntoBundle(linkPath: string, bundleRoot: string): boolean {
  try {
    const target = fs.readlinkSync(linkPath);
    return path.resolve(target).startsWith(path.resolve(bundleRoot) + path.sep);
  } catch {
    return false;
  }
}
