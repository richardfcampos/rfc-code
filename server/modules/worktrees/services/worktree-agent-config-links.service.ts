import path from 'node:path';

import type { WorktreeFileSystem } from '@/shared/types.js';

type AgentConfigEntry = {
  relativePath: string;
  kind: 'file' | 'dir';
};

// Gitignored on purpose (personal/editor-specific, must not land in the
// team's repository) but required for a session in the worktree to behave
// the same as one in the main checkout: CLAUDE.md/.cursor carry agent
// instructions (e.g. the CodeGraph usage rule), .mcp.json wires the local
// MCP gateway.
const AGENT_CONFIG_ENTRIES: AgentConfigEntry[] = [
  { relativePath: 'CLAUDE.md', kind: 'file' },
  { relativePath: '.cursor', kind: 'dir' },
  { relativePath: '.mcp.json', kind: 'file' },
];

export type AgentConfigLinkResult = {
  linked: string[];
  failed: string[];
};

/**
 * Makes the main checkout's gitignored agent-config entries visible from a
 * freshly created worktree.
 *
 * `git worktree add` only materializes tracked files, so anything gitignored
 * (CLAUDE.md, .cursor/, .mcp.json) is silently missing in a new worktree and
 * a session opened there loses shared agent instructions and MCP wiring.
 * Each missing entry gets a symlink back to the main checkout; an entry the
 * worktree already has (e.g. a worktree-specific override, or a tracked file
 * of the same name) is left untouched so it always wins over the link.
 *
 * Linking is best effort: a failed link must not fail worktree creation, the
 * worktree is still usable without that one entry.
 */
export async function linkAgentConfigFilesIntoWorktree(
  repositoryRoot: string,
  worktreePath: string,
  fileSystem: WorktreeFileSystem,
): Promise<AgentConfigLinkResult> {
  const result: AgentConfigLinkResult = { linked: [], failed: [] };

  for (const entry of AGENT_CONFIG_ENTRIES) {
    const sourcePath = path.join(repositoryRoot, entry.relativePath);
    const linkPath = path.join(worktreePath, entry.relativePath);

    if (!(await fileSystem.pathExists(sourcePath))) {
      continue;
    }
    if (await fileSystem.pathExists(linkPath)) {
      continue;
    }

    try {
      if (entry.kind === 'dir') {
        await fileSystem.createDirectorySymlink(sourcePath, linkPath);
      } else {
        await fileSystem.createFileSymlink(sourcePath, linkPath);
      }
      result.linked.push(entry.relativePath);
    } catch (error) {
      console.warn(`Could not link "${entry.relativePath}" into ${worktreePath}:`, error);
      result.failed.push(entry.relativePath);
    }
  }

  return result;
}
