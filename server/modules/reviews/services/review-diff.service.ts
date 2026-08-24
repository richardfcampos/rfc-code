/**
 * Reads a review's diff: the branch's work measured against the base branch.
 *
 * Uses the three-dot form (`base...branch`), so the review shows what the
 * branch added rather than everything that landed on the base meanwhile —
 * the same thing a pull request shows. Commands run in the main worktree and
 * every argument is either a constant or a value produced by
 * `resolveReviewContext`.
 */

import type { GitCommandRunner } from '@/shared/types.js';

import { ReviewFileNotInDiffError } from '../reviews.errors.js';

import type { ReviewContext } from './review-context.service.js';

export type ReviewDiffChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'changed';

export type ReviewDiffFile = {
  filePath: string;
  /** Populated only for renames and copies. */
  previousPath: string | null;
  changeKind: ReviewDiffChangeKind;
  additions: number;
  deletions: number;
};

/** Maps the leading letter of `--name-status` to a stable, readable kind. */
function readChangeKind(status: string): ReviewDiffChangeKind {
  switch (status[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'M':
      return 'modified';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'changed';
  }
}

/**
 * Parses `git diff --numstat --name-status` output.
 *
 * The two reports are requested separately because a single command cannot
 * emit both; they are joined on the path git prints last for an entry (the
 * destination path for renames and copies).
 */
export function parseReviewDiffFiles(nameStatus: string, numStat: string): ReviewDiffFile[] {
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of numStat.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    // Binary files report "-" instead of a count; they get zeroes.
    const additions = Number.parseInt(parts[0], 10);
    const deletions = Number.parseInt(parts[1], 10);
    const filePath = parts[parts.length - 1];
    counts.set(filePath, {
      additions: Number.isNaN(additions) ? 0 : additions,
      deletions: Number.isNaN(deletions) ? 0 : deletions,
    });
  }

  const files: ReviewDiffFile[] = [];
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;

    const status = parts[0];
    const filePath = parts[parts.length - 1];
    const previousPath = parts.length >= 3 ? parts[1] : null;

    files.push({
      filePath,
      previousPath,
      changeKind: readChangeKind(status),
      additions: counts.get(filePath)?.additions ?? 0,
      deletions: counts.get(filePath)?.deletions ?? 0,
    });
  }

  return files;
}

/** Every file the review's branch touched relative to the base branch. */
export async function listReviewDiffFiles(
  context: ReviewContext,
  runGit: GitCommandRunner,
): Promise<ReviewDiffFile[]> {
  const range = `${context.baseBranch}...${context.branch}`;
  const [nameStatus, numStat] = await Promise.all([
    runGit(['diff', '--name-status', range], context.repositoryRoot),
    runGit(['diff', '--numstat', range], context.repositoryRoot),
  ]);

  return parseReviewDiffFiles(nameStatus.stdout, numStat.stdout);
}

/**
 * The unified diff of one file.
 *
 * The path must be one this review's own file list reported: membership is the
 * real authorization check, so an arbitrary path can never be diffed through
 * this endpoint even though git would happily accept it.
 */
export async function readReviewFileDiff(
  context: ReviewContext,
  filePath: string,
  runGit: GitCommandRunner,
): Promise<{ file: ReviewDiffFile; diff: string }> {
  const files = await listReviewDiffFiles(context, runGit);
  const file = files.find(
    (candidate) => candidate.filePath === filePath || candidate.previousPath === filePath,
  );
  if (!file) {
    throw new ReviewFileNotInDiffError(filePath);
  }

  // A rename needs both sides in the pathspec for git to pair them up again.
  const pathspec = Array.from(new Set([file.previousPath, file.filePath].filter(Boolean) as string[]));
  const range = `${context.baseBranch}...${context.branch}`;
  const { stdout } = await runGit(
    ['diff', range, '--', ...pathspec],
    context.repositoryRoot,
  );

  return { file, diff: stdout };
}
