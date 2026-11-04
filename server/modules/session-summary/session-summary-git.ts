/**
 * Working-tree facts for a session summary: branch, what changed since HEAD,
 * untracked count and the last commit. Every command is best-effort — a
 * session may run in a directory that is not a repository, or whose worktree
 * was removed — so the whole block degrades to `null` instead of failing the
 * summary.
 */

import { execFile } from 'node:child_process';

import { MAX_SUMMARY_FILES, type SessionSummaryGit } from './session-summary.types.js';

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

/** Resolves with stdout, rejects on non-zero exit, timeout or missing git. */
export const defaultGitRunner: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT_BYTES }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout));
    });
  });

async function tryGit(run: GitRunner, args: string[], cwd: string): Promise<string | null> {
  try {
    return (await run(args, cwd)).trimEnd();
  } catch {
    return null;
  }
}

function lastLine(output: string): string | null {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1]! : null;
}

/**
 * Collects the git facts for `cwd`; `null` when it is not inside a repository
 * (or git is unavailable). Individual sub-facts that fail come back as
 * null/empty rather than discarding the rest.
 */
export async function collectGitSummary(cwd: string | null, run: GitRunner = defaultGitRunner): Promise<SessionSummaryGit | null> {
  if (!cwd) return null;
  const inside = await tryGit(run, ['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside !== 'true') return null;

  const branch = await tryGit(run, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  // A repository with no commit yet has no HEAD to diff against; the stat is
  // simply empty then, the same as a clean tree.
  const stat = await tryGit(run, ['diff', '--stat', 'HEAD', '--'], cwd);
  const names = await tryGit(run, ['diff', '--name-only', 'HEAD', '--'], cwd);
  // `--no-optional-locks`: a read-only status must never take index.lock from the agent's own git.
  const status = await tryGit(run, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], cwd);
  const commit = await tryGit(run, ['log', '-1', '--format=%h%x09%s'], cwd);

  const files = (names ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const untracked = (status ?? '').split('\n').filter((line) => line.startsWith('??')).length;
  const [hash, ...messageParts] = (commit ?? '').split('\t');

  return {
    branch,
    diffStat: stat ? lastLine(stat) : null,
    files: files.slice(0, MAX_SUMMARY_FILES),
    filesTruncated: files.length > MAX_SUMMARY_FILES,
    untracked,
    lastCommit: hash ? { hash, message: messageParts.join('\t') } : null,
  };
}
