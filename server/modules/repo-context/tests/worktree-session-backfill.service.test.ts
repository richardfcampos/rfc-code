import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appConfigDb,
  closeConnection,
  getConnection,
  initializeDatabase,
} from '@/modules/database/index.js';
import {
  runWorktreeSessionBackfill,
  type WorktreeSessionBackfillDependencies,
} from '@/modules/repo-context/services/worktree-session-backfill.service.js';
import type { WorktreeContext } from '@/modules/repo-context/services/worktree-context.service.js';

const REPO = '/home/user/repo';
const WORKTREE = '/home/user/repo-worktrees/feature-login';
const OTHER_REPO = '/home/user/other';

type ProjectRow = { project_path: string; isArchived: number };
type SessionRow = {
  session_id: string;
  project_path: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  jsonl_path: string | null;
};

/**
 * Every case runs against a throwaway SQLite file so the real installation is
 * never touched and cases cannot leak rows into each other.
 */
async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'worktree-backfill-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function insertProject(projectPath: string, isArchived = 0): void {
  getConnection()
    .prepare('INSERT INTO projects (project_id, project_path, isArchived) VALUES (?, ?, ?)')
    .run(`project-${projectPath}`, projectPath, isArchived);
}

function insertSession(sessionId: string, projectPath: string): void {
  getConnection()
    .prepare(
      `INSERT INTO sessions (session_id, provider, project_path, jsonl_path)
       VALUES (?, 'claude', ?, ?)`,
    )
    .run(sessionId, projectPath, `/transcripts/${sessionId}.jsonl`);
}

function readSession(sessionId: string): SessionRow {
  return getConnection()
    .prepare(
      'SELECT session_id, project_path, worktree_path, worktree_branch, jsonl_path FROM sessions WHERE session_id = ?',
    )
    .get(sessionId) as SessionRow;
}

function readProject(projectPath: string): ProjectRow | undefined {
  return getConnection()
    .prepare('SELECT project_path, isArchived FROM projects WHERE project_path = ?')
    .get(projectPath) as ProjectRow | undefined;
}

/**
 * Fake resolver/filesystem: no git process is spawned and no real directory is
 * consulted, so results do not depend on the machine running the suite.
 */
function createDependencies(options: {
  existingDirectories?: string[];
  gitRepositories?: string[];
  contexts?: Record<string, WorktreeContext>;
  failOn?: Record<string, string>;
}): WorktreeSessionBackfillDependencies {
  const existing = new Set(options.existingDirectories ?? []);
  const repositories = new Set(options.gitRepositories ?? []);
  const contexts = options.contexts ?? {};
  const failures = options.failOn ?? {};

  return {
    async resolveContext(cwd) {
      const failure = failures[cwd];
      if (failure) {
        throw new Error(failure);
      }
      return (
        contexts[cwd] ?? { projectPath: cwd, worktreePath: null, worktreeBranch: null }
      );
    },
    async directoryExists(candidatePath) {
      const failure = failures[candidatePath];
      if (failure) {
        throw new Error(failure);
      }
      return existing.has(candidatePath);
    },
    async isGitRepository(candidatePath) {
      return repositories.has(candidatePath);
    },
  };
}

test('backfill re-points a worktree session to the parent repository', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(REPO);
    insertProject(WORKTREE);
    insertSession('session-worktree', WORKTREE);
    insertSession('session-repo', REPO);

    const summary = await runWorktreeSessionBackfill(
      createDependencies({
        existingDirectories: [REPO, WORKTREE],
        contexts: {
          [WORKTREE]: {
            projectPath: REPO,
            worktreePath: WORKTREE,
            worktreeBranch: 'feature/login',
          },
          [REPO]: { projectPath: REPO, worktreePath: null, worktreeBranch: null },
        },
      }),
    );

    const moved = readSession('session-worktree');
    assert.equal(moved.project_path, REPO);
    assert.equal(moved.worktree_path, WORKTREE);
    assert.equal(moved.worktree_branch, 'feature/login');
    assert.equal(moved.jsonl_path, '/transcripts/session-worktree.jsonl');

    const untouched = readSession('session-repo');
    assert.equal(untouched.project_path, REPO);
    assert.equal(untouched.worktree_path, null);

    assert.equal(summary.reassignedPaths, 1);
    assert.equal(summary.reassignedSessions, 1);
    assert.equal(summary.failedPaths, 0);
  });
});

test('backfill uses the path shape when the worktree directory is gone', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(REPO);
    insertProject(WORKTREE);
    insertSession('session-missing-dir', WORKTREE);

    await runWorktreeSessionBackfill(
      createDependencies({
        existingDirectories: [REPO],
        gitRepositories: [REPO],
      }),
    );

    const moved = readSession('session-missing-dir');
    assert.equal(moved.project_path, REPO);
    assert.equal(moved.worktree_path, WORKTREE);
    // No directory left to read a branch from; the list falls back to the folder name.
    assert.equal(moved.worktree_branch, null);
  });
});

test('backfill creates the parent project row when it does not exist yet', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(WORKTREE);
    insertSession('session-orphan-parent', WORKTREE);

    await runWorktreeSessionBackfill(
      createDependencies({ existingDirectories: [REPO], gitRepositories: [REPO] }),
    );

    const parent = readProject(REPO);
    assert.ok(parent);
    assert.equal(parent.isArchived, 0);
    assert.equal(readSession('session-orphan-parent').project_path, REPO);
  });
});

test('backfill leaves the session untouched when the path shape does not match', async () => {
  await withIsolatedDatabase(async () => {
    const strayPath = '/home/user/deleted-folder';
    insertProject(strayPath);
    insertSession('session-stray', strayPath);

    const summary = await runWorktreeSessionBackfill(
      createDependencies({ existingDirectories: [], gitRepositories: [] }),
    );

    const untouched = readSession('session-stray');
    assert.equal(untouched.project_path, strayPath);
    assert.equal(untouched.worktree_path, null);
    assert.equal(untouched.worktree_branch, null);
    assert.equal(summary.reassignedPaths, 0);
    assert.equal(readProject(strayPath)?.isArchived, 0);
  });
});

test('backfill leaves the session untouched when the derived parent is not a repository', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(WORKTREE);
    insertSession('session-parent-not-git', WORKTREE);

    await runWorktreeSessionBackfill(
      createDependencies({ existingDirectories: [REPO], gitRepositories: [] }),
    );

    assert.equal(readSession('session-parent-not-git').project_path, WORKTREE);
    assert.equal(readSession('session-parent-not-git').worktree_path, null);
  });
});

test('backfill archives the emptied project instead of deleting it', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(REPO);
    insertProject(WORKTREE);
    insertSession('session-only', WORKTREE);

    const summary = await runWorktreeSessionBackfill(
      createDependencies({
        existingDirectories: [REPO, WORKTREE],
        contexts: {
          [WORKTREE]: { projectPath: REPO, worktreePath: WORKTREE, worktreeBranch: 'wt' },
        },
      }),
    );

    const emptied = readProject(WORKTREE);
    assert.ok(emptied, 'the worktree project row must survive the backfill');
    assert.equal(emptied.isArchived, 1);
    assert.equal(readProject(REPO)?.isArchived, 0);
    assert.equal(summary.archivedProjects, 1);
  });
});

test('backfill keeps a project active when sessions remain under it', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(REPO);
    insertProject(WORKTREE);
    insertSession('session-moved', WORKTREE);
    // A session already carrying a worktree path is out of the backfill's reach
    // and keeps the old project row populated.
    getConnection()
      .prepare(
        `INSERT INTO sessions (session_id, provider, project_path, worktree_path)
         VALUES ('session-pinned', 'claude', ?, ?)`,
      )
      .run(WORKTREE, WORKTREE);

    const summary = await runWorktreeSessionBackfill(
      createDependencies({
        existingDirectories: [REPO, WORKTREE],
        contexts: {
          [WORKTREE]: { projectPath: REPO, worktreePath: WORKTREE, worktreeBranch: 'wt' },
        },
      }),
    );

    assert.equal(readProject(WORKTREE)?.isArchived, 0);
    assert.equal(summary.archivedProjects, 0);
    assert.equal(readSession('session-pinned').project_path, WORKTREE);
  });
});

test('backfill isolates a failing path from the rest of the run', async () => {
  await withIsolatedDatabase(async () => {
    const brokenWorktree = '/home/user/broken-worktrees/wt';
    insertProject(REPO);
    insertProject(WORKTREE);
    insertProject(brokenWorktree);
    insertSession('session-good', WORKTREE);
    insertSession('session-broken', brokenWorktree);

    const summary = await runWorktreeSessionBackfill(
      createDependencies({
        existingDirectories: [REPO, WORKTREE],
        contexts: {
          [WORKTREE]: { projectPath: REPO, worktreePath: WORKTREE, worktreeBranch: 'wt' },
        },
        failOn: { [brokenWorktree]: 'EIO: filesystem unavailable' },
      }),
    );

    assert.equal(summary.failedPaths, 1);
    assert.equal(summary.reassignedPaths, 1);
    assert.equal(readSession('session-good').project_path, REPO);
    assert.equal(readSession('session-broken').project_path, brokenWorktree);
    assert.equal(readSession('session-broken').worktree_path, null);
  });
});

test('backfill does not move a subdirectory session to the repository root', async () => {
  await withIsolatedDatabase(async () => {
    const packageDirectory = '/home/user/repo/packages/api';
    insertProject(packageDirectory);
    insertSession('session-package', packageDirectory);

    await runWorktreeSessionBackfill(
      createDependencies({
        existingDirectories: [packageDirectory],
        contexts: {
          [packageDirectory]: {
            projectPath: REPO,
            worktreePath: null,
            worktreeBranch: null,
          },
        },
      }),
    );

    // Re-pointing it would silently change the directory the session resumes in.
    assert.equal(readSession('session-package').project_path, packageDirectory);
  });
});

test('backfill ignores a plain repository that owns its sessions', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(OTHER_REPO);
    insertSession('session-plain', OTHER_REPO);

    const summary = await runWorktreeSessionBackfill(
      createDependencies({ existingDirectories: [OTHER_REPO] }),
    );

    assert.equal(readSession('session-plain').project_path, OTHER_REPO);
    assert.equal(summary.reassignedPaths, 0);
    assert.equal(readProject(OTHER_REPO)?.isArchived, 0);
  });
});

test('backfill is a no-op on the second run', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(REPO);
    insertProject(WORKTREE);
    insertSession('session-once', WORKTREE);

    const dependencies = createDependencies({
      existingDirectories: [REPO, WORKTREE],
      contexts: {
        [WORKTREE]: { projectPath: REPO, worktreePath: WORKTREE, worktreeBranch: 'wt' },
      },
    });

    const first = await runWorktreeSessionBackfill(dependencies);
    assert.equal(first.alreadyDone, false);
    assert.equal(first.reassignedSessions, 1);

    // A session re-created under the old worktree project after the first pass
    // must survive untouched: the flag closes the migration for good.
    insertSession('session-after-flag', WORKTREE);

    const second = await runWorktreeSessionBackfill(dependencies);
    assert.equal(second.alreadyDone, true);
    assert.equal(second.examinedPaths, 0);
    assert.equal(second.reassignedSessions, 0);
    assert.equal(readSession('session-after-flag').project_path, WORKTREE);
    assert.ok(appConfigDb.get('worktree_session_backfill_done'));
  });
});

test('backfill never deletes sessions and never rewrites jsonl_path', async () => {
  await withIsolatedDatabase(async () => {
    insertProject(REPO);
    insertProject(WORKTREE);
    insertSession('session-a', WORKTREE);
    insertSession('session-b', WORKTREE);
    insertSession('session-c', REPO);

    await runWorktreeSessionBackfill(
      createDependencies({
        existingDirectories: [REPO, WORKTREE],
        contexts: {
          [WORKTREE]: { projectPath: REPO, worktreePath: WORKTREE, worktreeBranch: 'wt' },
        },
      }),
    );

    const rows = getConnection()
      .prepare('SELECT session_id, jsonl_path FROM sessions ORDER BY session_id')
      .all() as Array<Pick<SessionRow, 'session_id' | 'jsonl_path'>>;

    assert.deepEqual(rows, [
      { session_id: 'session-a', jsonl_path: '/transcripts/session-a.jsonl' },
      { session_id: 'session-b', jsonl_path: '/transcripts/session-b.jsonl' },
      { session_id: 'session-c', jsonl_path: '/transcripts/session-c.jsonl' },
    ]);
  });
});
