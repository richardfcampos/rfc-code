import path from 'node:path';

import type {
  CreateWorktreeInput,
  CreateWorktreeResult,
  GitCommandRunner,
  WorktreeFileSystem,
} from '@/shared/types.js';
import { AppError, normalizeProjectPath } from '@/shared/utils.js';
import {
  listWorktreePorcelainEntries,
  validateWorktreeBranchName,
} from '@/modules/worktrees/services/worktree-git.service.js';
import { linkProjectSkillsIntoWorktree } from '@/modules/worktrees/services/worktree-skill-links.service.js';

/**
 * Turns a branch name into a filesystem-safe folder name:
 * "feature/login-form" → "feature-login-form".
 */
function sanitizeBranchForDirectoryName(branch: string): string {
  const sanitized = branch
    .replace(/[/\\:*?"<>|\s]+/g, '-')
    .replace(/\.+$/g, '')
    .replace(/^-+|-+$/g, '');

  if (!sanitized) {
    throw new AppError('Branch name cannot be converted to a folder name', {
      code: 'INVALID_WORKTREE_FOLDER_NAME',
      statusCode: 400,
    });
  }

  return sanitized;
}

// Auto-derived names collide on the same prompt prefix; a bounded search keeps
// a pathological container from turning into an endless probe.
const MAX_UNIQUE_BRANCH_ATTEMPTS = 50;

type WorktreeCandidate = {
  branch: string;
  worktreePath: string;
  collision: AppError | null;
};

/**
 * Resolves the folder a branch would occupy and the reason it cannot be used,
 * if any: the branch is already checked out somewhere, or the folder is taken.
 */
async function probeWorktreeCandidate(
  branch: string,
  entries: Awaited<ReturnType<typeof listWorktreePorcelainEntries>>,
  worktreesContainer: string,
  fileSystem: WorktreeFileSystem,
): Promise<WorktreeCandidate> {
  const worktreePath = normalizeProjectPath(
    path.join(worktreesContainer, sanitizeBranchForDirectoryName(branch)),
  );

  const checkedOutElsewhere = entries.find((entry) => entry.branch === branch);
  if (checkedOutElsewhere) {
    return {
      branch,
      worktreePath,
      collision: new AppError(`Branch "${branch}" is already checked out in another worktree`, {
        code: 'BRANCH_ALREADY_CHECKED_OUT',
        statusCode: 409,
        details: checkedOutElsewhere.path,
      }),
    };
  }

  if (await fileSystem.pathExists(worktreePath)) {
    return {
      branch,
      worktreePath,
      collision: new AppError(`Folder already exists: ${worktreePath}`, {
        code: 'WORKTREE_FOLDER_EXISTS',
        statusCode: 409,
      }),
    };
  }

  return { branch, worktreePath, collision: null };
}

/**
 * Creates a new worktree in a sibling folder of the repository:
 * `<repoParent>/<repoName>-worktrees/<branch>`. Existing local branches are
 * checked out directly; unknown branch names are created from `baseBranch`
 * (falling back to the main worktree's branch). With `uniqueBranch`, a name
 * that collides is suffixed `-2`, `-3`, … until a free one is found. Untracked
 * project skills from the main checkout are linked into the new worktree
 * afterwards.
 */
export async function createWorktree(
  input: CreateWorktreeInput,
  dependencies: {
    runGit: GitCommandRunner;
    fileSystem: WorktreeFileSystem;
    // Fire-and-forget: called after the worktree exists so sessions opened
    // there inherit the repository's CodeGraph index. Never awaited — index
    // failures must not fail worktree creation.
    armCodegraphIndex?: (repositoryRoot: string, worktreePath: string) => void;
  },
): Promise<CreateWorktreeResult> {
  const { fileSystem, runGit } = dependencies;
  const requestedBranch = validateWorktreeBranchName(input.branch);

  const entries = await listWorktreePorcelainEntries(input.projectPath, runGit);
  const repositoryRoot = entries[0].path;

  const worktreesContainer = path.join(
    path.dirname(repositoryRoot),
    `${path.basename(repositoryRoot)}-worktrees`,
  );

  let candidate = await probeWorktreeCandidate(
    requestedBranch,
    entries,
    worktreesContainer,
    fileSystem,
  );
  if (input.uniqueBranch) {
    for (let attempt = 2; candidate.collision && attempt <= MAX_UNIQUE_BRANCH_ATTEMPTS; attempt++) {
      candidate = await probeWorktreeCandidate(
        `${requestedBranch}-${attempt}`,
        entries,
        worktreesContainer,
        fileSystem,
      );
    }
  }
  if (candidate.collision) {
    throw candidate.collision;
  }
  const { branch, worktreePath } = candidate;

  const { stdout: branchListOutput } = await runGit(
    ['branch', '--list', branch, '--format=%(refname:short)'],
    repositoryRoot,
  );
  const branchExists = branchListOutput
    .split('\n')
    .some((line) => line.trim() === branch);

  if (branchExists) {
    await runGit(['worktree', 'add', worktreePath, branch], repositoryRoot);
  } else {
    const baseBranch = input.baseBranch?.trim() || entries[0].branch;
    if (!baseBranch) {
      throw new AppError('Cannot determine a base branch (main worktree is detached)', {
        code: 'WORKTREE_BASE_BRANCH_UNKNOWN',
        statusCode: 400,
      });
    }

    await runGit(
      ['worktree', 'add', worktreePath, '-b', branch, validateWorktreeBranchName(baseBranch)],
      repositoryRoot,
    );
  }

  await linkProjectSkillsIntoWorktree(repositoryRoot, worktreePath, fileSystem);
  dependencies.armCodegraphIndex?.(repositoryRoot, worktreePath);

  return { worktreePath, branch, createdBranch: !branchExists };
}
