import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { beforeEach } from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CursorSessionSynchronizer } from '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js';
import { OpenCodeSessionSynchronizer } from '@/modules/providers/list/opencode/opencode-session-synchronizer.provider.js';
import { __resetWorktreeContextCache } from '@/modules/repo-context/index.js';
import type { GitCommandResult, GitCommandRunner } from '@/shared/types.js';

/**
 * Every case below stands up its own isolated sqlite file so sessions written
 * by one test never leak into the next, mirroring the harness already used by
 * `profile-aware-sync.test.ts` for these same four synchronizers.
 */
async function withDatabaseEnvironment(
  runTest: (tempDir: string) => void | Promise<void>,
): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'worktree-session-sync-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  await initializeDatabase();

  try {
    await runTest(tempDir);
  } finally {
    closeConnection();
    if (previous === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previous;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeArtifact(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

type GitResponses = {
  commonDir?: string;
  toplevel?: string;
  abbrevRef?: string;
};

/**
 * Fake `GitCommandRunner` mirroring the shapes `resolveWorktreeContext` relies
 * on, copied from `worktree-context.service.test.ts` so every synchronizer
 * test below can drive worktree resolution without spawning real git.
 */
function createFakeRunner(responses: GitResponses): GitCommandRunner {
  return async (args: string[]): Promise<GitCommandResult> => {
    if (args.includes('--git-common-dir')) {
      if (responses.commonDir === undefined) {
        throw new Error('not a git repository');
      }
      return { stdout: `${responses.commonDir}\n`, stderr: '' };
    }
    if (args.includes('--show-toplevel')) {
      return { stdout: `${responses.toplevel ?? ''}\n`, stderr: '' };
    }
    if (args.includes('--abbrev-ref')) {
      if (responses.abbrevRef === undefined) {
        throw new Error('unborn branch');
      }
      return { stdout: `${responses.abbrevRef}\n`, stderr: '' };
    }

    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  };
}

// The resolver cache is keyed by normalized cwd and shared across the whole
// process, so a stale hit from one test's fake runner must never answer the
// next test's lookup for the same path.
beforeEach(() => {
  __resetWorktreeContextCache();
});

test('claude sync groups a worktree cwd under the parent repository', async () => {
  await withDatabaseEnvironment(async (tempDir) => {
    const mainRoot = '/home/dev/repo';
    const worktreeCwd = '/home/dev/repo-worktrees/feature-login';
    const artifact = path.join(tempDir, 'claude-worktree.jsonl');
    await writeArtifact(artifact, JSON.stringify({ sessionId: 'claude-wt-1', cwd: worktreeCwd }));

    const runGit = createFakeRunner({
      commonDir: `${mainRoot}/.git`,
      toplevel: worktreeCwd,
      abbrevRef: 'feature/login',
    });
    await new ClaudeSessionSynchronizer(runGit).synchronizeFile(artifact);

    const row = sessionsDb.getSessionById('claude-wt-1');
    assert.equal(row?.project_path, mainRoot);
    assert.equal(row?.worktree_path, worktreeCwd);
    assert.equal(row?.worktree_branch, 'feature/login');
  });
});

test('claude sync leaves worktree columns null for a plain cwd', async () => {
  await withDatabaseEnvironment(async (tempDir) => {
    const mainRoot = '/home/dev/repo-plain';
    const artifact = path.join(tempDir, 'claude-plain.jsonl');
    await writeArtifact(artifact, JSON.stringify({ sessionId: 'claude-plain-1', cwd: mainRoot }));

    const runGit = createFakeRunner({ commonDir: `${mainRoot}/.git`, toplevel: mainRoot });
    await new ClaudeSessionSynchronizer(runGit).synchronizeFile(artifact);

    const row = sessionsDb.getSessionById('claude-plain-1');
    assert.equal(row?.project_path, mainRoot);
    assert.equal(row?.worktree_path, null);
    assert.equal(row?.worktree_branch, null);
  });
});

test('codex sync groups a worktree cwd under the parent repository', async () => {
  await withDatabaseEnvironment(async (tempDir) => {
    const mainRoot = '/home/dev/repo';
    const worktreeCwd = '/home/dev/repo-worktrees/feature-login';
    const artifact = path.join(tempDir, 'codex-worktree.jsonl');
    await writeArtifact(
      artifact,
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'codex-wt-1', cwd: worktreeCwd, thread_source: 'user', source: 'cli' },
      }),
    );

    const runGit = createFakeRunner({
      commonDir: `${mainRoot}/.git`,
      toplevel: worktreeCwd,
      abbrevRef: 'feature/login',
    });
    await new CodexSessionSynchronizer(runGit).synchronizeFile(artifact);

    const row = sessionsDb.getSessionById('codex-wt-1');
    assert.equal(row?.project_path, mainRoot);
    assert.equal(row?.worktree_path, worktreeCwd);
    assert.equal(row?.worktree_branch, 'feature/login');
  });
});

test('codex sync leaves worktree columns null for a plain cwd', async () => {
  await withDatabaseEnvironment(async (tempDir) => {
    const mainRoot = '/home/dev/repo-plain';
    const artifact = path.join(tempDir, 'codex-plain.jsonl');
    await writeArtifact(
      artifact,
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'codex-plain-1', cwd: mainRoot, thread_source: 'user', source: 'cli' },
      }),
    );

    const runGit = createFakeRunner({ commonDir: `${mainRoot}/.git`, toplevel: mainRoot });
    await new CodexSessionSynchronizer(runGit).synchronizeFile(artifact);

    const row = sessionsDb.getSessionById('codex-plain-1');
    assert.equal(row?.project_path, mainRoot);
    assert.equal(row?.worktree_path, null);
    assert.equal(row?.worktree_branch, null);
  });
});

test('cursor sync groups a worktree cwd under the parent repository', async () => {
  await withDatabaseEnvironment(async (tempDir) => {
    const mainRoot = '/home/dev/repo';
    const worktreeCwd = '/home/dev/repo-worktrees/feature-login';
    const cursorHome = path.join(tempDir, '.cursor');
    const artifact = path.join(cursorHome, 'projects', 'hash', 'chats', 'cursor-wt-1.jsonl');
    // worker.log lives at dirname^3(artifact) = <cursorHome>/projects/worker.log
    await writeArtifact(path.join(cursorHome, 'projects', 'worker.log'), `workspacePath=${worktreeCwd}\n`);
    await writeArtifact(
      artifact,
      JSON.stringify({ role: 'user', message: { content: [{ text: 'hello world' }] } }),
    );

    const runGit = createFakeRunner({
      commonDir: `${mainRoot}/.git`,
      toplevel: worktreeCwd,
      abbrevRef: 'feature/login',
    });
    await new CursorSessionSynchronizer(runGit).synchronizeFile(artifact);

    const row = sessionsDb.getSessionById('cursor-wt-1');
    assert.equal(row?.project_path, mainRoot);
    assert.equal(row?.worktree_path, worktreeCwd);
    assert.equal(row?.worktree_branch, 'feature/login');
  });
});

test('cursor sync leaves worktree columns null for a plain cwd', async () => {
  await withDatabaseEnvironment(async (tempDir) => {
    const mainRoot = '/home/dev/repo-plain';
    const cursorHome = path.join(tempDir, '.cursor');
    const artifact = path.join(cursorHome, 'projects', 'hash', 'chats', 'cursor-plain-1.jsonl');
    await writeArtifact(path.join(cursorHome, 'projects', 'worker.log'), `workspacePath=${mainRoot}\n`);
    await writeArtifact(
      artifact,
      JSON.stringify({ role: 'user', message: { content: [{ text: 'hello world' }] } }),
    );

    const runGit = createFakeRunner({ commonDir: `${mainRoot}/.git`, toplevel: mainRoot });
    await new CursorSessionSynchronizer(runGit).synchronizeFile(artifact);

    const row = sessionsDb.getSessionById('cursor-plain-1');
    assert.equal(row?.project_path, mainRoot);
    assert.equal(row?.worktree_path, null);
    assert.equal(row?.worktree_branch, null);
  });
});

test('opencode sync groups a worktree cwd under the parent repository', async () => {
  await withDatabaseEnvironment(async (tempDir) => {
    const mainRoot = '/home/dev/repo';
    const worktreeCwd = '/home/dev/repo-worktrees/feature-login';
    const dbPath = path.join(tempDir, 'opencode.db');

    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE project (id TEXT, worktree TEXT);
      CREATE TABLE session (
        id TEXT, directory TEXT, title TEXT,
        time_created INTEGER, time_updated INTEGER, time_archived INTEGER, project_id TEXT
      );
      INSERT INTO project (id, worktree) VALUES ('p1', '${worktreeCwd}');
      INSERT INTO session (id, directory, title, time_created, time_updated, time_archived, project_id)
        VALUES ('oc-wt-1', '${worktreeCwd}', 'My OpenCode Session', 1000, 2000, NULL, 'p1');
    `);
    seed.close();

    const runGit = createFakeRunner({
      commonDir: `${mainRoot}/.git`,
      toplevel: worktreeCwd,
      abbrevRef: 'feature/login',
    });
    await new OpenCodeSessionSynchronizer(runGit).synchronizeFile(dbPath);

    const row = sessionsDb.getSessionById('oc-wt-1');
    assert.equal(row?.project_path, mainRoot);
    assert.equal(row?.worktree_path, worktreeCwd);
    assert.equal(row?.worktree_branch, 'feature/login');
  });
});

test('opencode sync leaves worktree columns null for a plain cwd', async () => {
  await withDatabaseEnvironment(async (tempDir) => {
    const mainRoot = '/home/dev/repo-plain';
    const dbPath = path.join(tempDir, 'opencode.db');

    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE project (id TEXT, worktree TEXT);
      CREATE TABLE session (
        id TEXT, directory TEXT, title TEXT,
        time_created INTEGER, time_updated INTEGER, time_archived INTEGER, project_id TEXT
      );
      INSERT INTO project (id, worktree) VALUES ('p1', '${mainRoot}');
      INSERT INTO session (id, directory, title, time_created, time_updated, time_archived, project_id)
        VALUES ('oc-plain-1', '${mainRoot}', 'My OpenCode Session', 1000, 2000, NULL, 'p1');
    `);
    seed.close();

    const runGit = createFakeRunner({ commonDir: `${mainRoot}/.git`, toplevel: mainRoot });
    await new OpenCodeSessionSynchronizer(runGit).synchronizeFile(dbPath);

    const row = sessionsDb.getSessionById('oc-plain-1');
    assert.equal(row?.project_path, mainRoot);
    assert.equal(row?.worktree_path, null);
    assert.equal(row?.worktree_branch, null);
  });
});
