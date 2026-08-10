import { access, stat } from 'node:fs/promises';
import path from 'node:path';

import { appConfigDb, getConnection, projectsDb } from '@/modules/database/index.js';
import { normalizeProjectPath } from '@/shared/utils.js';
import {
  resolveWorktreeContext,
  type WorktreeContext,
} from '@/modules/repo-context/services/worktree-context.service.js';

/**
 * Sessions recorded before worktrees became a session-level detail live under a
 * project row of their own — the worktree directory. This one-shot pass moves
 * them back under the repository they belong to, so their history reappears in
 * the parent project's list.
 *
 * It runs as a boot service rather than a SQL migration because deciding where
 * a session belongs needs git and the filesystem, both asynchronous and both
 * allowed to fail. Every failure mode degrades to "leave the session exactly as
 * it is": rows are only ever re-pointed, never deleted, and `jsonl_path` is
 * never touched, so a partial pass is as safe as no pass at all.
 */

const BACKFILL_FLAG_KEY = 'worktree_session_backfill_done';

/** Folder suffix `createWorktree` gives the container of a repository's worktrees. */
const WORKTREE_CONTAINER_SUFFIX = '-worktrees';

export type WorktreeSessionBackfillDependencies = {
  /** Resolves an existing directory to its repository/worktree pair. */
  resolveContext: (cwd: string) => Promise<WorktreeContext>;
  /** True when the path exists and is a directory. */
  directoryExists: (candidatePath: string) => Promise<boolean>;
  /** True when the directory is a git repository (main worktree or linked). */
  isGitRepository: (candidatePath: string) => Promise<boolean>;
};

export type WorktreeSessionBackfillSummary = {
  /** True when the flag was already set and nothing was inspected. */
  alreadyDone: boolean;
  examinedPaths: number;
  /** Distinct project paths whose sessions were moved to a repository root. */
  reassignedPaths: number;
  reassignedSessions: number;
  archivedProjects: number;
  failedPaths: number;
};

type ReassignmentPlan = {
  previousProjectPath: string;
  projectPath: string;
  worktreePath: string;
  worktreeBranch: string | null;
};

function comparablePath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

async function defaultDirectoryExists(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

async function defaultIsGitRepository(candidatePath: string): Promise<boolean> {
  try {
    // A linked worktree stores `.git` as a file and a main worktree as a
    // directory, so plain existence is the check that covers both.
    await access(path.join(candidatePath, '.git'));
    return true;
  } catch {
    return false;
  }
}

const defaultDependencies: WorktreeSessionBackfillDependencies = {
  resolveContext: (cwd) => resolveWorktreeContext(cwd),
  directoryExists: defaultDirectoryExists,
  isGitRepository: defaultIsGitRepository,
};

/**
 * Derives the repository root of a worktree directory that no longer exists,
 * using the only layout this app ever creates: `<repo>-worktrees/<slug>`.
 *
 * Deliberately strict — the slug must sit directly inside the container — so a
 * path that merely looks similar cannot drag sessions into an unrelated
 * repository. Returns null when the shape does not match.
 */
function deriveRepositoryRootFromPathShape(worktreePath: string): string | null {
  const container = path.dirname(worktreePath);
  const slug = path.basename(worktreePath);
  if (!slug || container === worktreePath) {
    return null;
  }

  const containerName = path.basename(container);
  if (!containerName.endsWith(WORKTREE_CONTAINER_SUFFIX)) {
    return null;
  }

  const repositoryName = containerName.slice(0, -WORKTREE_CONTAINER_SUFFIX.length);
  if (!repositoryName) {
    return null;
  }

  return normalizeProjectPath(path.join(path.dirname(container), repositoryName));
}

/**
 * Decides whether the sessions of `projectPath` belong to another repository.
 *
 * Returns null whenever the answer is anything but a confident "yes": directory
 * missing and unshaped, not a repository, or already at its repository root.
 */
async function planReassignment(
  projectPath: string,
  dependencies: WorktreeSessionBackfillDependencies,
): Promise<ReassignmentPlan | null> {
  if (await dependencies.directoryExists(projectPath)) {
    const context = await dependencies.resolveContext(projectPath);
    // Only a secondary worktree is re-pointed. A directory that resolves to a
    // repository root above it (a package inside a monorepo, say) is left
    // alone: moving it would change where the session runs on resume without
    // recording any worktree to run it in.
    if (!context.worktreePath) {
      return null;
    }
    if (comparablePath(context.projectPath) === comparablePath(projectPath)) {
      return null;
    }

    return {
      previousProjectPath: projectPath,
      projectPath: context.projectPath,
      worktreePath: context.worktreePath,
      worktreeBranch: context.worktreeBranch,
    };
  }

  const repositoryRoot = deriveRepositoryRootFromPathShape(projectPath);
  if (!repositoryRoot || comparablePath(repositoryRoot) === comparablePath(projectPath)) {
    return null;
  }
  if (!(await dependencies.directoryExists(repositoryRoot))) {
    return null;
  }
  if (!(await dependencies.isGitRepository(repositoryRoot))) {
    return null;
  }

  return {
    previousProjectPath: projectPath,
    projectPath: repositoryRoot,
    // The directory is gone, so no branch can be read. The session list falls
    // back to the folder name; guessing a branch from the slug would show a
    // label that may never have existed.
    worktreePath: projectPath,
    worktreeBranch: null,
  };
}

/**
 * Applies one plan atomically: the parent project row, the session rows and the
 * archival of the emptied project either all land or none do.
 */
function applyReassignment(plan: ReassignmentPlan): { sessions: number; archived: boolean } {
  const db = getConnection();

  const run = db.transaction((): { sessions: number; archived: boolean } => {
    // The sessions foreign key points at projects.project_path, so the parent
    // row has to exist before any session can reference it.
    projectsDb.createProjectPath(plan.projectPath);

    const update = db
      .prepare(
        `UPDATE sessions
            SET project_path = ?, worktree_path = ?, worktree_branch = ?
          WHERE project_path = ? AND worktree_path IS NULL`,
      )
      .run(plan.projectPath, plan.worktreePath, plan.worktreeBranch, plan.previousProjectPath);

    const remaining = db
      .prepare('SELECT COUNT(*) AS total FROM sessions WHERE project_path = ?')
      .get(plan.previousProjectPath) as { total: number };

    let archived = false;
    // A project row left without sessions is archived, never deleted: the user
    // may have opened that worktree as a project on purpose and can bring it
    // back from the archive.
    if (remaining.total === 0) {
      const result = db
        .prepare('UPDATE projects SET isArchived = 1 WHERE project_path = ? AND isArchived = 0')
        .run(plan.previousProjectPath);
      archived = result.changes > 0;
    }

    return { sessions: update.changes, archived };
  });

  return run();
}

function readPendingProjectPaths(): string[] {
  const rows = getConnection()
    .prepare(
      `SELECT DISTINCT project_path
         FROM sessions
        WHERE worktree_path IS NULL AND project_path IS NOT NULL AND project_path <> ''`,
    )
    .all() as Array<{ project_path: string }>;

  return rows.map((row) => row.project_path);
}

/**
 * Re-points sessions of already-known worktree directories to their repository.
 *
 * Runs at most once per installation (guarded by an `app_config` flag) and never
 * rejects: the boot sequence must proceed even if the pass cannot run at all.
 */
export async function runWorktreeSessionBackfill(
  dependencies: WorktreeSessionBackfillDependencies = defaultDependencies,
): Promise<WorktreeSessionBackfillSummary> {
  const summary: WorktreeSessionBackfillSummary = {
    alreadyDone: false,
    examinedPaths: 0,
    reassignedPaths: 0,
    reassignedSessions: 0,
    archivedProjects: 0,
    failedPaths: 0,
  };

  try {
    if (appConfigDb.get(BACKFILL_FLAG_KEY)) {
      summary.alreadyDone = true;
      return summary;
    }

    const projectPaths = readPendingProjectPaths();
    summary.examinedPaths = projectPaths.length;

    for (const projectPath of projectPaths) {
      try {
        const plan = await planReassignment(projectPath, dependencies);
        if (!plan) {
          continue;
        }

        const { sessions, archived } = applyReassignment(plan);
        summary.reassignedPaths += 1;
        summary.reassignedSessions += sessions;
        if (archived) {
          summary.archivedProjects += 1;
        }
      } catch (error) {
        // One unreadable directory or locked row must not cost the user the
        // rest of the backfill, and must never take the boot down with it.
        summary.failedPaths += 1;
        console.warn(
          `Worktree session backfill skipped ${projectPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // The pass is one-shot: it either moved a session or decided to leave it
    // alone, and both verdicts are final. Sessions skipped or failed keep the
    // grouping they already had, which is the pre-feature behavior.
    appConfigDb.set(BACKFILL_FLAG_KEY, new Date().toISOString());
  } catch (error) {
    // No flag is written here, so a pass that could not even start (database
    // unavailable, for instance) is retried on the next boot.
    console.warn(
      `Worktree session backfill did not run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return summary;
}
