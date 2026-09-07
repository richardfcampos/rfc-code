import path from 'node:path';

import type { WorktreeFileSystem } from '@/shared/types.js';

const SKILLS_RELATIVE_PATH = path.join('.claude', 'skills');

export type SkillLinkResult = {
  linked: string[];
  failed: string[];
};

/**
 * Makes the main checkout's project skills visible from a freshly created
 * worktree.
 *
 * `git worktree add` only materializes tracked files. Skills authored under
 * `<repo>/.claude/skills` are frequently untracked (personal tooling that must
 * not land in the team's repository), so a session opened in the worktree
 * silently loses them. Each missing skill folder gets a symlink back to the
 * main checkout; skills already present in the worktree (tracked ones) are
 * left untouched so the tracked version always wins.
 *
 * Linking is best effort: a failed link must not fail worktree creation, the
 * worktree is still usable without that one skill.
 */
export async function linkProjectSkillsIntoWorktree(
  repositoryRoot: string,
  worktreePath: string,
  fileSystem: WorktreeFileSystem,
): Promise<SkillLinkResult> {
  const result: SkillLinkResult = { linked: [], failed: [] };

  const sourceSkillsDir = path.join(repositoryRoot, SKILLS_RELATIVE_PATH);
  const skillNames = await fileSystem.listDirectories(sourceSkillsDir);
  if (skillNames.length === 0) {
    return result;
  }

  const targetSkillsDir = path.join(worktreePath, SKILLS_RELATIVE_PATH);
  try {
    await fileSystem.ensureDirectory(targetSkillsDir);
  } catch (error) {
    console.warn(`Could not prepare ${targetSkillsDir} for skill links:`, error);
    result.failed.push(...skillNames);
    return result;
  }

  for (const skillName of skillNames) {
    const linkPath = path.join(targetSkillsDir, skillName);
    if (await fileSystem.pathExists(linkPath)) {
      continue;
    }

    try {
      await fileSystem.createDirectorySymlink(path.join(sourceSkillsDir, skillName), linkPath);
      result.linked.push(skillName);
    } catch (error) {
      console.warn(`Could not link skill "${skillName}" into ${worktreePath}:`, error);
      result.failed.push(skillName);
    }
  }

  return result;
}
