/**
 * Resolves a review row into the git coordinates the diff and merge paths need.
 *
 * This is the module's security boundary for git arguments: the branch and the
 * two directory paths are never taken from a request. The task row supplies a
 * branch *name*, which is then matched against the repository's own
 * `git worktree list` output — so the values handed to git are the ones git
 * itself just reported, and a task pointing at a branch with no live worktree
 * fails here instead of reaching a command.
 */

import type { TaskReviewRow, TaskRow } from '@/modules/database/index.js';
import {
  findWorktreeEntryByPath,
  listWorktreePorcelainEntries,
  validateWorktreeBranchName,
} from '@/modules/worktrees/index.js';
import type { GitCommandRunner } from '@/shared/types.js';

import { ReviewTaskUnresolvedError, ReviewWorktreeMissingError } from '../reviews.errors.js';

/** Everything the diff, merge and comment paths need about one review. */
export type ReviewContext = {
  review: TaskReviewRow;
  task: TaskRow;
  /** Main worktree of the repository — the merge target's checkout. */
  repositoryRoot: string;
  /** Checkout the task's agent worked in. */
  worktreePath: string;
  /** Branch checked out in `worktreePath`. */
  branch: string;
  /** Branch checked out in `repositoryRoot`; the merge target and diff base. */
  baseBranch: string;
};

export type ReviewContextDeps = {
  runGit: GitCommandRunner;
  getTaskById: (taskId: string) => TaskRow | null;
  getProjectPathById: (projectId: string) => string | null;
};

/**
 * Loads the review's task and repository coordinates.
 *
 * Throws `ReviewTaskUnresolvedError` when the task or its project is gone, and
 * `ReviewWorktreeMissingError` when the task names no branch, names a branch
 * with no registered worktree, or the repository is on a detached HEAD (no
 * merge target can be named).
 */
export async function resolveReviewContext(
  review: TaskReviewRow,
  deps: ReviewContextDeps,
): Promise<ReviewContext> {
  const task = deps.getTaskById(review.task_id);
  if (!task) {
    throw new ReviewTaskUnresolvedError(`Task "${review.task_id}" for this review no longer exists`);
  }

  const projectPath = deps.getProjectPathById(task.project_name);
  if (!projectPath) {
    throw new ReviewTaskUnresolvedError(
      `Unable to resolve a project path for "${task.project_name}"`,
    );
  }

  if (!task.worktree_branch) {
    throw new ReviewWorktreeMissingError('This task has no worktree branch to review');
  }
  // Rejects the leading-dash and traversal forms before the name is compared,
  // so a hand-edited row cannot smuggle an option into a later git call.
  const branch = validateWorktreeBranchName(task.worktree_branch);

  const entries = await listWorktreePorcelainEntries(projectPath, deps.runGit);
  const repositoryRoot = entries[0].path;
  const baseBranch = entries[0].branch;
  if (!baseBranch) {
    throw new ReviewWorktreeMissingError(
      'The repository is on a detached HEAD — no base branch to review against',
    );
  }

  const worktreeEntry = entries.find(
    (entry) => entry.branch === branch && entry.path !== repositoryRoot,
  );
  if (!worktreeEntry) {
    throw new ReviewWorktreeMissingError(
      `No live worktree is checked out on "${branch}" in this repository`,
    );
  }

  // Re-derives the entry through the same lookup the merge path uses, so both
  // agree on exactly which registered worktree the review points at.
  const worktree = findWorktreeEntryByPath(entries, worktreeEntry.path);

  return {
    review,
    task,
    repositoryRoot,
    worktreePath: worktree.path,
    branch,
    baseBranch,
  };
}
