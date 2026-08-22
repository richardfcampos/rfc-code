import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { orgsDb } from '@/modules/database/repositories/orgs.db.js';
import { tasksDb } from '@/modules/database/repositories/tasks.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'tasks-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
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

function insertProfile(id: string, name: string, provider = 'claude'): void {
  getConnection()
    .prepare(`INSERT INTO profiles (id, provider, name, slug) VALUES (?, ?, ?, ?)`)
    .run(id, provider, name, id);
}

test('create defaults stage to backlog and origin to user', async () => {
  await withIsolatedDatabase(() => {
    const task = tasksDb.create({ title: 'Ship feature', projectName: 'my-app' });

    assert.ok(task.id);
    assert.equal(task.title, 'Ship feature');
    assert.equal(task.project_name, 'my-app');
    assert.equal(task.stage, 'backlog');
    assert.equal(task.origin, 'user');
    assert.equal(task.description, null);
    assert.equal(task.assignee_profile_id, null);
  });
});

test('create accepts optional fields including an assignee profile', async () => {
  await withIsolatedDatabase(() => {
    insertProfile('profile-a', 'Alice');

    const task = tasksDb.create({
      title: 'Investigate flaky test',
      projectName: 'my-app',
      description: 'Repro then fix',
      origin: 'agent',
      originDetail: 'triage-bot',
      assigneeProfileId: 'profile-a',
      suggestedSkill: 'debugger',
      worktreeBranch: 'fix/flaky-test',
    });

    assert.equal(task.description, 'Repro then fix');
    assert.equal(task.origin, 'agent');
    assert.equal(task.origin_detail, 'triage-bot');
    assert.equal(task.assignee_profile_id, 'profile-a');
    assert.equal(task.suggested_skill, 'debugger');
    assert.equal(task.worktree_branch, 'fix/flaky-test');
  });
});

test('an invalid stage is rejected by the CHECK constraint', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO tasks (id, project_name, title, stage) VALUES ('t1', 'my-app', 'Bad stage', 'not-a-stage')`,
          )
          .run(),
      /CHECK constraint failed/,
    );
  });
});

test('an invalid origin is rejected by the CHECK constraint', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO tasks (id, project_name, title, origin) VALUES ('t1', 'my-app', 'Bad origin', 'not-an-origin')`,
          )
          .run(),
      /CHECK constraint failed/,
    );
  });
});

test('listByProject orders by stage column order then most-recently-updated first', async () => {
  await withIsolatedDatabase(() => {
    const backlog = tasksDb.create({ title: 'Backlog task', projectName: 'my-app' });
    const inProgress = tasksDb.create({ title: 'In progress task', projectName: 'my-app' });
    tasksDb.update(inProgress.id, { stage: 'in_progress' });
    const otherProject = tasksDb.create({ title: 'Other project task', projectName: 'other-app' });

    const tasks = tasksDb.listByProject('my-app');
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, backlog.id);
    assert.equal(tasks[1].id, inProgress.id);
    assert.ok(!tasks.some((task) => task.id === otherProject.id));
  });
});

test('update writes only the provided fields and bumps updated_at', async () => {
  await withIsolatedDatabase(() => {
    const task = tasksDb.create({ title: 'Original title', projectName: 'my-app' });

    const updated = tasksDb.update(task.id, { stage: 'review' });
    assert.equal(updated?.stage, 'review');
    assert.equal(updated?.title, 'Original title');

    const renamed = tasksDb.update(task.id, { title: 'New title' });
    assert.equal(renamed?.title, 'New title');
    assert.equal(renamed?.stage, 'review');
  });
});

test('update rejects an invalid stage via the CHECK constraint', async () => {
  await withIsolatedDatabase(() => {
    const task = tasksDb.create({ title: 'Task', projectName: 'my-app' });
    const db = getConnection();

    assert.throws(
      () =>
        db
          .prepare(`UPDATE tasks SET stage = 'bogus-stage' WHERE id = ?`)
          .run(task.id),
      /CHECK constraint failed/,
    );
  });
});

test('deleting a task removes it', async () => {
  await withIsolatedDatabase(() => {
    const task = tasksDb.create({ title: 'Task', projectName: 'my-app' });
    assert.equal(tasksDb.delete(task.id), true);
    assert.equal(tasksDb.get(task.id), null);
    assert.equal(tasksDb.delete(task.id), false);
  });
});

test('deleting the assignee profile clears assignee_profile_id instead of blocking the delete', async () => {
  await withIsolatedDatabase(() => {
    insertProfile('profile-a', 'Alice');
    const task = tasksDb.create({
      title: 'Task',
      projectName: 'my-app',
      assigneeProfileId: 'profile-a',
    });

    getConnection().prepare('DELETE FROM profiles WHERE id = ?').run('profile-a');

    const reloaded = tasksDb.get(task.id);
    assert.equal(reloaded?.assignee_profile_id, null);
  });
});

test('fallback audit records entries and lists the most recent ones first', async () => {
  await withIsolatedDatabase(() => {
    const org = orgsDb.getDefault();
    assert.ok(org);
    insertProfile('profile-a', 'Alice');

    tasksDb.fallbackAudit.insert({
      orgId: org!.id,
      profileId: 'profile-a',
      projectName: 'my-app',
      reason: 'primary over quota',
      primaryUsagePct: 92,
    });
    tasksDb.fallbackAudit.insert({
      orgId: org!.id,
      profileId: 'profile-a',
      projectName: 'my-app',
      reason: 'primary unauthenticated',
      primaryUsagePct: null,
    });

    const recent = tasksDb.fallbackAudit.listRecent(10);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].reason, 'primary unauthenticated');
    assert.equal(recent[0].primary_usage_pct, null);
    assert.equal(recent[1].primary_usage_pct, 92);
  });
});
