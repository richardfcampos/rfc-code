import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { getProjectsCompact } from '@/modules/projects/services/projects-compact-list.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

class FakeConnection {
  readyState = 1;
  send(): void {}
}

async function withIsolatedDatabase(run: () => void | Promise<void>): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const dir = await mkdtemp(path.join(tmpdir(), 'projects-compact-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(dir, 'auth.db');
  await initializeDatabase();
  try {
    await run();
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test('getProjectsCompact returns one short row per project with counts and last activity', async () => {
  await withIsolatedDatabase(async () => {
    projectsDb.createProjectPath('/code/alpha', 'Alpha App');
    sessionsDb.createAppSession('a-1', 'claude', '/code/alpha');
    sessionsDb.createAppSession('a-2', 'codex', '/code/alpha');
    projectsDb.createProjectPath('/code/beta');

    const run = chatRunRegistry.startRun({ appSessionId: 'a-1', provider: 'claude', providerSessionId: null, connection: new FakeConnection(), userId: 1 });
    assert.ok(run);

    const items = await getProjectsCompact({ skipSynchronization: true });
    const alpha = items.find((item) => item.path === '/code/alpha');
    const beta = items.find((item) => item.path === '/code/beta');
    assert.ok(alpha && beta);
    assert.equal(alpha.name, 'Alpha App');
    assert.equal(alpha.activeSessions, 1);
    assert.equal(alpha.sessionsTotal, 2);
    assert.ok(alpha.lastActivity);
    assert.equal(beta.name, 'beta');
    assert.equal(beta.activeSessions, 0);
    assert.equal(beta.sessionsTotal, 0);
    assert.equal(beta.lastActivity, null);
    assert.deepEqual(Object.keys(alpha).sort(), ['activeSessions', 'lastActivity', 'name', 'path', 'projectId', 'sessionsTotal']);
  });
});

test('empty worktree registrations are omitted; worktrees with sessions stay', async () => {
  await withIsolatedDatabase(async () => {
    projectsDb.createProjectPath('/code/repo');
    projectsDb.createProjectPath('/code/repo-worktrees/wt-empty');
    projectsDb.createProjectPath('/code/repo-worktrees/wt-used');
    sessionsDb.createAppSession('w-1', 'claude', '/code/repo-worktrees/wt-used');

    const paths = (await getProjectsCompact({ skipSynchronization: true })).map((item) => item.path).sort();
    assert.deepEqual(paths, ['/code/repo', '/code/repo-worktrees/wt-used']);
  });
});
