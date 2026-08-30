import path from 'node:path';
import { stat } from 'node:fs/promises';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution, required
// because `codegraph` is an npm-installed shim on Windows.
import spawn from 'cross-spawn';

import { projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

export type ProjectCodegraphInfo = {
  hasCodegraph: boolean;
  indexing: boolean;
};

type SpawnLike = typeof spawn;

// Indexing runs are keyed by the directory being indexed, so a project and a
// worktree of the same repository can index independently without colliding.
const indexingPaths = new Set<string>();

export async function detectCodegraphIndex(projectPath: string): Promise<boolean> {
  try {
    const indexStats = await stat(path.join(projectPath, '.codegraph'));
    return indexStats.isDirectory();
  } catch {
    return false;
  }
}

export function isCodegraphIndexing(projectPath: string): boolean {
  return indexingPaths.has(path.resolve(projectPath));
}

export async function getProjectCodegraph(
  projectId: string,
  resolveProjectPathById: (id: string) => string | null = projectsDb.getProjectPathById,
): Promise<{ projectId: string; codegraph: ProjectCodegraphInfo }> {
  const projectPath = projectId ? resolveProjectPathById(projectId) : null;
  if (!projectPath) {
    throw new AppError(`Project "${projectId}" does not exist`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  return {
    projectId,
    codegraph: {
      hasCodegraph: await detectCodegraphIndex(projectPath),
      indexing: isCodegraphIndexing(projectPath),
    },
  };
}

/**
 * Kicks off `codegraph init` in `targetPath` and returns immediately —
 * indexing a large repository takes seconds to minutes, so callers respond
 * 202 and clients poll `getProjectCodegraph` until `hasCodegraph` flips.
 * Rejects (409) when an indexing run for the same directory is in flight.
 */
export function startCodegraphIndexing(
  targetPath: string,
  options: { onDone?: (success: boolean) => void; spawnFn?: SpawnLike } = {},
): void {
  const resolvedPath = path.resolve(targetPath);
  if (indexingPaths.has(resolvedPath)) {
    throw new AppError('CodeGraph indexing is already running for this project', {
      code: 'CODEGRAPH_INDEXING_IN_PROGRESS',
      statusCode: 409,
    });
  }

  const spawnFn = options.spawnFn ?? spawn;
  const child = spawnFn('codegraph', ['init'], {
    cwd: resolvedPath,
    stdio: 'ignore',
  });

  indexingPaths.add(resolvedPath);

  const finish = (success: boolean) => {
    indexingPaths.delete(resolvedPath);
    options.onDone?.(success);
  };

  child.on('error', (error: Error) => {
    console.error(`[CodeGraph] Failed to start indexing in ${resolvedPath}:`, error.message);
    finish(false);
  });

  child.on('close', (code: number | null) => {
    if (code !== 0) {
      console.error(`[CodeGraph] Indexing in ${resolvedPath} exited with code ${code}`);
    }
    finish(code === 0);
  });
}

/**
 * Route-facing wrapper: resolves the project directory from its DB id and
 * starts indexing there. 404 for unknown projects, 409 when already running.
 */
export async function startProjectCodegraphIndexing(
  projectId: string,
  resolveProjectPathById: (id: string) => string | null = projectsDb.getProjectPathById,
): Promise<void> {
  const projectPath = projectId ? resolveProjectPathById(projectId) : null;
  if (!projectPath) {
    throw new AppError(`Project "${projectId}" does not exist`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  startCodegraphIndexing(projectPath);
}

/**
 * Fire-and-forget companion for freshly created worktrees: when the source
 * repository is CodeGraph-indexed, index the new worktree too so sessions
 * opened there get the same structural queries. Never throws — a missing
 * binary or failed index must not break worktree creation.
 */
export async function startWorktreeCodegraphIndex(
  repositoryRoot: string,
  worktreePath: string,
  spawnFn?: SpawnLike,
): Promise<boolean> {
  try {
    if (!(await detectCodegraphIndex(repositoryRoot)) || isCodegraphIndexing(worktreePath)) {
      return false;
    }

    startCodegraphIndexing(worktreePath, { spawnFn });
    return true;
  } catch (error) {
    console.error(
      `[CodeGraph] Skipping auto-index of worktree ${worktreePath}:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
