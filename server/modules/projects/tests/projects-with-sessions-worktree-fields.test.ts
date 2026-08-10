import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { getProjectsWithSessions } from '@/modules/projects/services/projects-with-sessions-fetch.service.js';
import { sessionsService } from '@/modules/providers/index.js';
import type { WorktreeContext } from '@/modules/repo-context/index.js';

async function withProjectsEnvironment(runTest: () => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'projects-with-sessions-worktree-'));

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

// The sidebar payload carries the worktree pair in camelCase — the same
// contract as listArchivedSessions — so the session row can render the
// branch badge without a follow-up query.
test('getProjectsWithSessions exposes worktreePath and worktreeBranch on session items', async () => {
  await withProjectsEnvironment(async () => {
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

    const projects = await getProjectsWithSessions({ skipSynchronization: true });
    const parentProject = projects.find((project) => project.path === '/repo');

    assert.ok(parentProject, 'worktree session must be listed under the parent repository');
    const [session] = parentProject.sessions;
    assert.equal(session.id, created.sessionId);
    assert.equal(session.worktreePath, '/repo-worktrees/feature-login');
    assert.equal(session.worktreeBranch, 'feature/login');
  });
});

// A plain project session reports null for both fields — not undefined and
// not an empty string — so the frontend badge check is a simple truthiness
// test on worktreePath.
test('getProjectsWithSessions reports null worktree fields for a plain project session', async () => {
  await withProjectsEnvironment(async () => {
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

    const projects = await getProjectsWithSessions({ skipSynchronization: true });
    const plainProject = projects.find((project) => project.path === '/workspace/plain-project');

    assert.ok(plainProject, 'plain project must be listed');
    const [session] = plainProject.sessions;
    assert.equal(session.id, created.sessionId);
    assert.equal(session.worktreePath, null);
    assert.equal(session.worktreeBranch, null);
  });
});
