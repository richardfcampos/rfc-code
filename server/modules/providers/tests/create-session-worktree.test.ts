import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { WorktreeContext } from '@/modules/repo-context/index.js';

async function withSessionsEnvironment(runTest: () => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'create-session-worktree-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
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

/** Fake resolver standing in for `resolveWorktreeContext`, no real git spawned. */
function fakeResolver(context: WorktreeContext): (cwd: string) => Promise<WorktreeContext> {
  return async () => context;
}

// A worktree cwd resolves to the parent repo's path, and the worktree pair is
// persisted alongside the row instead of spawning a separate project.
test('createAppSession groups a worktree cwd under the parent repository', async () => {
  await withSessionsEnvironment(async () => {
    const result = await sessionsService.createAppSession(
      'claude',
      '/repo-worktrees/feature-login',
      null,
      fakeResolver({
        projectPath: '/repo',
        worktreePath: '/repo-worktrees/feature-login',
        worktreeBranch: 'feature/login',
      }),
    );

    assert.equal(result.projectPath, '/repo');

    const row = sessionsDb.getSessionById(result.sessionId);
    assert.equal(row?.project_path, '/repo');
    assert.equal(row?.worktree_path, '/repo-worktrees/feature-login');
    assert.equal(row?.worktree_branch, 'feature/login');
  });
});

// A plain (non-worktree) cwd keeps today's behavior: project_path is the cwd
// itself and both worktree columns stay NULL.
test('createAppSession leaves worktree columns null for a plain project path', async () => {
  await withSessionsEnvironment(async () => {
    const result = await sessionsService.createAppSession(
      'claude',
      '/workspace/plain-project',
      null,
      fakeResolver({
        projectPath: '/workspace/plain-project',
        worktreePath: null,
        worktreeBranch: null,
      }),
    );

    assert.equal(result.projectPath, '/workspace/plain-project');

    const row = sessionsDb.getSessionById(result.sessionId);
    assert.equal(row?.project_path, '/workspace/plain-project');
    assert.equal(row?.worktree_path, null);
    assert.equal(row?.worktree_branch, null);
  });
});

// The listing payload carries the two new fields in camelCase so the sidebar
// can render the worktree branch badge without a follow-up query.
test('listArchivedSessions exposes worktreePath and worktreeBranch', async () => {
  await withSessionsEnvironment(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/repo-worktrees/feature-login',
      null,
      fakeResolver({
        projectPath: '/repo',
        worktreePath: '/repo-worktrees/feature-login',
        worktreeBranch: 'feature/login',
      }),
    );
    sessionsDb.updateSessionIsArchived(created.sessionId, true);

    const [item] = sessionsService.listArchivedSessions();

    assert.equal(item.sessionId, created.sessionId);
    assert.equal(item.worktreePath, '/repo-worktrees/feature-login');
    assert.equal(item.worktreeBranch, 'feature/login');
  });
});

// A plain project row reports null for both new fields, not an empty string,
// so the frontend can use them as a straightforward presence check.
test('listArchivedSessions reports null worktree fields for a plain project', async () => {
  await withSessionsEnvironment(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/plain-project',
      null,
      fakeResolver({
        projectPath: '/workspace/plain-project',
        worktreePath: null,
        worktreeBranch: null,
      }),
    );
    sessionsDb.updateSessionIsArchived(created.sessionId, true);

    const [item] = sessionsService.listArchivedSessions();

    assert.equal(item.sessionId, created.sessionId);
    assert.equal(item.worktreePath, null);
    assert.equal(item.worktreeBranch, null);
  });
});
