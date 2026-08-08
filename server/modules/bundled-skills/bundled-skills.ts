/**
 * Exposes the skills bundled with the app inside each profile's config dir.
 *
 * Claude Code only discovers skills under `$CLAUDE_CONFIG_DIR/skills`, and this
 * fork gives every account profile a different config dir — so bundling skills
 * with the image is not enough on its own, they have to be reachable from the
 * directory the session actually runs against.
 *
 * Each enabled skill is a symlink into the one read-only copy shipped in the
 * image rather than a per-profile copy: the bundle is ~28 MB, and duplicating
 * it per account would cost that much again for every profile while making
 * updates land in some profiles and not others.
 *
 * Symlinking skills individually (instead of the whole directory) is what makes
 * per-profile selection possible, and leaves room for a profile to hold skills
 * of its own alongside the bundled ones.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A skill the user can turn on or off for a profile. */
export type BundledSkill = {
  name: string;
  description: string;
  /** Support directories other skills load at runtime; always linked. */
  required: boolean;
};

/**
 * Directories that carry no `SKILL.md` of their own but that skills import at
 * runtime. They are linked unconditionally: `common/` holds the API key helper
 * several skills import, and the others back `skill-creator`. Offering them as
 * toggles would let someone switch off a dependency and break skills that look
 * unrelated.
 */
const REQUIRED_ENTRIES = new Set(['common', 'references', 'scripts', 'ck-help', 'document-skills']);

export function getBundledSkillsRoot(): string {
  return process.env.BUNDLED_SKILLS_ROOT || '/opt/rfc-code/skills';
}

export function resolveProfileSkillsDir(profileDir: string): string {
  return path.join(profileDir, 'skills');
}

/** Reads a skill's one-line description out of its SKILL.md frontmatter. */
function readDescription(skillDir: string): string {
  try {
    const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const match = raw.match(/^description:\s*(.+)$/m);
    return match ? match[1].trim().slice(0, 200) : '';
  } catch {
    return '';
  }
}

/** Everything shipped in the image, whether or not any profile uses it. */
export function listBundledSkills(): BundledSkill[] {
  const root = getBundledSkillsRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    // No bundle (e.g. running the server outside the image) is not an error —
    // it just means there is nothing to offer.
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      description: readDescription(path.join(root, entry.name)),
      required: REQUIRED_ENTRIES.has(entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Names currently linked into a profile, ignoring anything it owns itself. */
export function listEnabledSkills(profileDir: string): string[] {
  const skillsDir = resolveProfileSkillsDir(profileDir);
  const bundleRoot = getBundledSkillsRoot();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isSymbolicLink())
    .filter((entry) => {
      // Only report links that point back into the bundle — a profile may hold
      // its own skills, and those are not ours to report or to remove.
      try {
        const target = fs.realpathSync(path.join(skillsDir, entry.name));
        return target.startsWith(fs.realpathSync(bundleRoot) + path.sep);
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
}

/** Links one bundled skill into a profile. Idempotent. */
export function enableSkill(profileDir: string, name: string): void {
  const source = path.join(getBundledSkillsRoot(), name);
  if (!fs.existsSync(source)) {
    throw new Error(`Bundled skill "${name}" does not exist.`);
  }

  const skillsDir = resolveProfileSkillsDir(profileDir);
  fs.mkdirSync(skillsDir, { recursive: true });
  const link = path.join(skillsDir, name);

  const existing = lstatOrNull(link);
  if (existing && !existing.isSymbolicLink()) {
    // A real directory is a skill the user installed here themselves.
    return;
  }
  if (existing?.isSymbolicLink()) {
    if (!pointsIntoBundle(link)) {
      // Someone linked this name at their own target — a different skill that
      // happens to share a name. Replacing it would silently swap out the one
      // they chose, so the bundled copy yields instead.
      return;
    }
    // Ours already: replace it so a stale target from an older image is
    // repaired rather than left dangling.
    fs.unlinkSync(link);
  }

  fs.symlinkSync(source, link);
}

/** True when a path resolves inside the bundle shipped with the image. */
function pointsIntoBundle(linkPath: string): boolean {
  try {
    const target = fs.realpathSync(linkPath);
    const root = fs.realpathSync(getBundledSkillsRoot());
    return target === root || target.startsWith(root + path.sep);
  } catch {
    // A dangling link points nowhere, so it is not one of the user's own.
    return true;
  }
}

/**
 * Relinks dangling bundle links in a profile, without changing its selection.
 *
 * The links are absolute, so moving the data directory to another machine (or
 * relocating the bundle) leaves every one of them dangling and the profile's
 * sessions with no skills at all. Only names that exist in the bundle are
 * relinked; a dangling link with a foreign name is the user's own (its target
 * may be temporarily unmounted) and is left alone, as are working links and
 * real directories.
 */
export function repairSkillLinks(profileDir: string): void {
  const skillsDir = resolveProfileSkillsDir(profileDir);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    // No skills directory means nothing to repair — profiles that predate
    // bundling have their own restore path.
    return;
  }

  const bundledNames = new Set(listBundledSkills().map((skill) => skill.name));
  for (const entry of entries) {
    if (!entry.isSymbolicLink() || !bundledNames.has(entry.name)) {
      continue;
    }
    if (fs.existsSync(path.join(skillsDir, entry.name))) {
      continue;
    }
    enableSkill(profileDir, entry.name);
  }
}

/** Removes the link for one bundled skill. Leaves user-owned dirs alone. */
export function disableSkill(profileDir: string, name: string): void {
  const link = path.join(resolveProfileSkillsDir(profileDir), name);
  const existing = lstatOrNull(link);
  if (existing?.isSymbolicLink()) {
    fs.unlinkSync(link);
  }
}

/**
 * Brings a profile in line with an explicit selection.
 *
 * Required entries are linked regardless of what was asked for, so a selection
 * cannot leave a skill without the helper it imports.
 */
export function applySkillSelection(profileDir: string, enabled: readonly string[]): void {
  const wanted = new Set(enabled);
  for (const skill of listBundledSkills()) {
    if (skill.required || wanted.has(skill.name)) {
      enableSkill(profileDir, skill.name);
    } else {
      disableSkill(profileDir, skill.name);
    }
  }
}

/**
 * Links every bundled skill. Used when a profile is created, so a new account
 * starts with the full toolbox and the panel is for narrowing it down.
 */
export function enableAllSkills(profileDir: string): void {
  for (const skill of listBundledSkills()) {
    enableSkill(profileDir, skill.name);
  }
}

/**
 * Config directory used by sessions that are not bound to an account profile.
 *
 * These sessions keep the provider CLI's own default directory, so the bundle
 * has to be linked there too — otherwise the skills shipped with the app are
 * invisible to anyone who has not created a profile, which is the default state
 * of a fresh install.
 */
export function resolveDefaultClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/**
 * Links the bundle into the default config dir, best effort.
 *
 * Runs at startup and is idempotent. Failures are logged rather than thrown: a
 * read-only or missing home should degrade to "no bundled skills", never stop
 * the server from booting.
 */
export function ensureDefaultConfigDirSkills(): void {
  try {
    const skills = listBundledSkills();
    if (skills.length === 0) {
      return;
    }
    enableAllSkills(resolveDefaultClaudeConfigDir());
  } catch (error) {
    console.warn(
      '[skills] Could not link bundled skills into the default config directory:',
      error instanceof Error ? error.message : error,
    );
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}
