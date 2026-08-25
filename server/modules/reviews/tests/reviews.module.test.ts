/**
 * Covers the wiring the module owns: a card moved to Review through the tasks
 * service must open a review by itself, through the shared stage-change seam.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  projectsDb,
  taskReviewsDb,
  tasksDb,
} from '@/modules/database/index.js';
import { tasksService } from '@/modules/tasks/index.js';

import { configureReviewsRuntime } from '../reviews.module.js';

import { createScriptedRepository } from './scripted-git-repository.js';

async function withServer(
  runTest: (context: { projectId: string; branch: string }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'reviews-module-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(databaseDirectory, 'auth.db');
  await initializeDatabase();

  const repository = await createScriptedRepository();
  const created = projectsDb.createProjectPath(repository.root, 'demo');
  assert.ok(created.project, 'the scripted repository should register as a project');
  // No provider runtime is needed: these tests never route a comment, and the
  // call is what installs the stage subscription.
  configureReviewsRuntime({ spawnFns: {} });

  try {
    await runTest({ projectId: created.project.project_id, branch: repository.branch });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await repository.cleanup();
    await rm(databaseDirectory, { recursive: true, force: true });
  }
}

test('moving a task with a worktree to review opens its review', async () => {
  await withServer(async ({ projectId, branch }) => {
    const task = await tasksService.createTask({
      title: 'Employee form',
      project: projectId,
      worktree_branch: branch,
    });

    await tasksService.updateTask(task.id, { stage: 'review' });

    const review = taskReviewsDb.getLiveByTask(task.id);
    assert.ok(review, 'a review should have been opened');
    assert.equal(review.state, 'open');
  });
});

test('a task without a worktree opens no review', async () => {
  await withServer(async ({ projectId }) => {
    const task = await tasksService.createTask({ title: 'Write the docs', project: projectId });

    await tasksService.updateTask(task.id, { stage: 'review' });

    assert.equal(taskReviewsDb.getLiveByTask(task.id), null);
  });
});

test('moving to any other column opens nothing', async () => {
  await withServer(async ({ projectId, branch }) => {
    const task = await tasksService.createTask({
      title: 'Employee form',
      project: projectId,
      worktree_branch: branch,
    });

    await tasksService.updateTask(task.id, { stage: 'in_progress' });
    await tasksService.updateTask(task.id, { stage: 'done' });

    assert.equal(taskReviewsDb.getLiveByTask(task.id), null);
  });
});

test('configuring twice keeps exactly one subscription', async () => {
  await withServer(async ({ projectId, branch }) => {
    configureReviewsRuntime({ spawnFns: {} });
    configureReviewsRuntime({ spawnFns: {} });

    const task = await tasksService.createTask({
      title: 'Employee form',
      project: projectId,
      worktree_branch: branch,
    });
    await tasksService.updateTask(task.id, { stage: 'review' });

    // A second subscription would try to open a second review for the same
    // task and hit the database's one-live-review rule.
    assert.ok(taskReviewsDb.getLiveByTask(task.id));
    assert.equal(tasksDb.get(task.id)?.stage, 'review');
  });
});
