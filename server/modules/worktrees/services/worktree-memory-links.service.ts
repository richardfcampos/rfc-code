import path from 'node:path';

import type { WorktreeFileSystem } from '@/shared/types.js';
import { resolveClaudeMemoryDir } from '@/modules/profiles/index.js';

export type MemoryLinkResult = {
  linked: string[];
  skipped: string[];
  failed: string[];
};

/**
 * Points a new worktree's auto-memory at the main checkout's.
 *
 * Auto-memory is keyed by working directory, so a session opened in a
 * worktree starts with an empty memory and never sees what earlier sessions
 * on the same repository learned (nor do its own notes flow back). Linking
 * the worktree's memory dir to the root's, in every Claude config dir that
 * may host a session there, gives one memory per repository per profile.
 *
 * A worktree memory dir that already exists is left alone: it may hold notes
 * from before this link existed, and replacing it would lose them.
 * Best effort: a failed link must not fail worktree creation.
 */
export async function linkClaudeMemoryIntoWorktree(
  repositoryRoot: string,
  worktreePath: string,
  claudeConfigDirs: string[],
  fileSystem: WorktreeFileSystem,
): Promise<MemoryLinkResult> {
  const result: MemoryLinkResult = { linked: [], skipped: [], failed: [] };

  for (const configDir of claudeConfigDirs) {
    const rootMemory = resolveClaudeMemoryDir(configDir, repositoryRoot);
    const worktreeMemory = resolveClaudeMemoryDir(configDir, worktreePath);
    try {
      if (await fileSystem.pathExists(worktreeMemory)) {
        result.skipped.push(worktreeMemory);
        continue;
      }
      // The root may not have written memory yet; an empty target still lets
      // the first worktree session's notes land where later sessions look.
      await fileSystem.ensureDirectory(rootMemory);
      await fileSystem.ensureDirectory(path.dirname(worktreeMemory));
      await fileSystem.createDirectorySymlink(rootMemory, worktreeMemory);
      result.linked.push(worktreeMemory);
    } catch (error) {
      console.warn(`Could not link auto-memory for ${worktreePath} under ${configDir}:`, error);
      result.failed.push(worktreeMemory);
    }
  }

  return result;
}
