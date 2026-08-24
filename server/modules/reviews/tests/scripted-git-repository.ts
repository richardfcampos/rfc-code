/**
 * Builds a throwaway git repository with one worktree, for the tests that must
 * exercise real git behaviour (diff ranges, a merge, a conflict).
 *
 * Identity and default branch are passed per command so the developer's global
 * git configuration never changes the outcome.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runGitCommand } from '@/shared/git-command.js';

const GIT_IDENTITY = [
  '-c',
  'user.name=Review Test',
  '-c',
  'user.email=review@test.local',
  '-c',
  'commit.gpgsign=false',
];

export type ScriptedRepository = {
  root: string;
  worktreePath: string;
  baseBranch: string;
  branch: string;
  /** Commits a file on the given branch's worktree. */
  commitFile(worktree: string, filePath: string, contents: string, message: string): Promise<void>;
  cleanup(): Promise<void>;
};

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await runGitCommand([...GIT_IDENTITY, ...args], cwd);
  return stdout;
}

/**
 * Creates a repository on `main` with one commit, plus a worktree checked out
 * on `feature` in a sibling directory.
 */
export async function createScriptedRepository(
  options: { baseBranch?: string; branch?: string } = {},
): Promise<ScriptedRepository> {
  const baseBranch = options.baseBranch ?? 'main';
  const branch = options.branch ?? 'feature/employee-form';

  const directory = await mkdtemp(path.join(tmpdir(), 'review-git-'));
  const root = path.join(directory, 'repo');
  const worktreePath = path.join(directory, 'worktree');

  await git(['init', '--initial-branch', baseBranch, root], directory);

  const commitFile = async (
    worktree: string,
    filePath: string,
    contents: string,
    message: string,
  ): Promise<void> => {
    await writeFile(path.join(worktree, filePath), contents, 'utf-8');
    await git(['add', '--', filePath], worktree);
    await git(['commit', '-m', message], worktree);
  };

  await commitFile(root, 'README.md', '# demo\n', 'chore: initial commit');
  await git(['worktree', 'add', '-b', branch, worktreePath, baseBranch], root);

  return {
    root,
    worktreePath,
    baseBranch,
    branch,
    commitFile,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
