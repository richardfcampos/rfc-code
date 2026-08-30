import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { getProjectsWithSessions } from '@/modules/projects/services/projects-with-sessions-fetch.service.js';

async function withProjectsEnvironment(runTest: () => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'projects-with-sessions-task-id-'));

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

test('getProjectsWithSessions exposes taskId on a session linked to a task', async () => {
  await withProjectsEnvironment(async () => {
    sessionsDb.createAppSession('session-linked', 'claude', '/workspace/linked-project');
    sessionsDb.setTaskId('session-linked', 'TASK-42');

    const projects = await getProjectsWithSessions({ skipSynchronization: true });
    const project = projects.find((item) => item.path === '/workspace/linked-project');

    assert.ok(project, 'project must be listed');
    const [session] = project.sessions;
    assert.equal(session.id, 'session-linked');
    assert.equal(session.taskId, 'TASK-42');
  });
});

// A session with no linked task reports null for taskId — not undefined and
// not an empty string — matching the null contract of the other optional
// session fields (worktreePath, worktreeBranch).
test('getProjectsWithSessions reports null taskId for a session with no linked task', async () => {
  await withProjectsEnvironment(async () => {
    sessionsDb.createAppSession('session-unlinked', 'claude', '/workspace/unlinked-project');

    const projects = await getProjectsWithSessions({ skipSynchronization: true });
    const project = projects.find((item) => item.path === '/workspace/unlinked-project');

    assert.ok(project, 'project must be listed');
    const [session] = project.sessions;
    assert.equal(session.id, 'session-unlinked');
    assert.equal(session.taskId, null);
  });
});
