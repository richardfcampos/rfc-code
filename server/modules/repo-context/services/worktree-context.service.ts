import path from 'node:path';

import type { GitCommandRunner } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';
import { runGitCommand } from '@/shared/git-command.js';

/**
 * Where a session physically runs vs. which repository it belongs to.
 *
 * `projectPath` is always populated (it falls back to the directory itself), so
 * callers can persist it unconditionally. `worktreePath` is null whenever the
 * directory already is the repository root — that is the "no worktree" case and
 * must stay indistinguishable from a plain project.
 */
export type WorktreeContext = {
  projectPath: string;
  worktreePath: string | null;
  worktreeBranch: string | null;
};

type CacheEntry = {
  expiresAt: number;
  promise: Promise<WorktreeContext>;
};

// A transcript scan resolves the same directory dozens of times, so results are
// memoized. The TTL is short because the checked-out branch is part of the
// answer and can change between scans.
const CACHE_TTL_MS = 30_000;
// Matches the per-repository fan-out used elsewhere in this module: a scan may
// ask for hundreds of directories at once and must not fork a git per entry.
const GIT_CONCURRENCY = 4;

const cache = new Map<string, CacheEntry>();
const warnedDirectories = new Set<string>();

let activeGitResolutions = 0;
const pendingGitResolutions: Array<() => void> = [];

async function acquireGitSlot(): Promise<void> {
  if (activeGitResolutions < GIT_CONCURRENCY) {
    activeGitResolutions += 1;
    return;
  }
  await new Promise<void>((resolve) => pendingGitResolutions.push(resolve));
}

function releaseGitSlot(): void {
  const next = pendingGitResolutions.shift();
  // Hand the slot straight to the next waiter instead of decrementing, otherwise
  // a burst of waiters could all wake up and exceed the limit.
  if (next) {
    next();
    return;
  }
  activeGitResolutions -= 1;
}

function comparablePath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/** True when the path's last segment is `.git`, regardless of separator flavor. */
function endsWithGitDirectory(normalizedPath: string): boolean {
  const segments = normalizedPath.split(/[\\/]/);
  return segments[segments.length - 1] === '.git';
}

function fallbackContext(cwd: string): WorktreeContext {
  return { projectPath: normalizeProjectPath(cwd) || cwd, worktreePath: null, worktreeBranch: null };
}

function warnOnce(cacheKey: string, cwd: string, reason: string): void {
  if (warnedDirectories.has(cacheKey)) {
    return;
  }
  warnedDirectories.add(cacheKey);
  console.warn(`Worktree context unresolved for ${cwd}: ${reason}`);
}

/**
 * Reads the branch label for a secondary worktree. A detached HEAD reports the
 * literal "HEAD", which is useless as a badge, so it degrades to the short SHA.
 * Failures here are non-fatal: the directory is still a known worktree, and the
 * UI falls back to the folder name when the label is missing.
 */
async function readWorktreeBranch(cwd: string, runGit: GitCommandRunner): Promise<string | null> {
  try {
    const { stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    const branch = stdout.trim();
    if (branch && branch !== 'HEAD') {
      return branch;
    }
  } catch {
    return null;
  }

  try {
    const { stdout } = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function resolveUncached(
  cwd: string,
  cacheKey: string,
  runGit: GitCommandRunner,
): Promise<WorktreeContext> {
  await acquireGitSlot();
  try {
    const commonDirResult = await runGit(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      cwd,
    );
    const commonDir = normalizeProjectPath(commonDirResult.stdout.trim());
    // Bare repositories (and anything else whose common dir is not a `.git`
    // folder) have no main worktree to group sessions under.
    if (!commonDir || !endsWithGitDirectory(commonDir)) {
      warnOnce(cacheKey, cwd, 'git common directory is not a worktree .git folder');
      return fallbackContext(cwd);
    }

    const mainRoot = normalizeProjectPath(path.dirname(commonDir));
    const toplevelResult = await runGit(['rev-parse', '--show-toplevel'], cwd);
    const toplevel = normalizeProjectPath(toplevelResult.stdout.trim());
    if (!toplevel) {
      warnOnce(cacheKey, cwd, 'git returned an empty worktree root');
      return fallbackContext(cwd);
    }

    if (comparablePath(mainRoot) === comparablePath(toplevel)) {
      return { projectPath: toplevel, worktreePath: null, worktreeBranch: null };
    }

    return {
      projectPath: mainRoot,
      worktreePath: toplevel,
      worktreeBranch: await readWorktreeBranch(cwd, runGit),
    };
  } catch (error) {
    // Missing git, missing directory, timeout: the caller still needs a usable
    // project path, and the user must not see an error for a plain folder.
    warnOnce(cacheKey, cwd, error instanceof Error ? error.message : String(error));
    return fallbackContext(cwd);
  } finally {
    releaseGitSlot();
  }
}

/**
 * Resolves which repository `cwd` belongs to and, when `cwd` is a secondary
 * worktree, the worktree path and branch to persist alongside the session.
 * Never rejects: an unresolvable directory maps to itself.
 */
export function resolveWorktreeContext(
  cwd: string,
  runGit: GitCommandRunner = runGitCommand,
): Promise<WorktreeContext> {
  const cacheKey = normalizeProjectPath(cwd);
  if (!cacheKey) {
    return Promise.resolve(fallbackContext(cwd));
  }

  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = resolveUncached(cwd, cacheKey, runGit);
  cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, promise });
  return promise;
}

/** Test-only hook: drops memoized results so cases do not leak into each other. */
export function __resetWorktreeContextCache(): void {
  cache.clear();
  warnedDirectories.clear();
}
