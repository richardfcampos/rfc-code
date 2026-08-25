import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { reviewCommentsDb } from '@/modules/database/repositories/review-comments.db.js';
import { taskReviewsDb } from '@/modules/database/repositories/task-reviews.db.js';
import { tasksDb } from '@/modules/database/repositories/tasks.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'task-reviews-db-'));

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

function createTask(title = 'Ship it', projectName = 'my-app'): string {
  return tasksDb.create({ title, projectName, worktreeBranch: 'feat/x' }).id;
}

test('create opens a review in the open state', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();

    const review = taskReviewsDb.create(taskId);

    assert.ok(review.review_id);
    assert.equal(review.task_id, taskId);
    assert.equal(review.state, 'open');
    assert.deepEqual(taskReviewsDb.get(review.review_id), review);
  });
});

test('a task can only hold one live review at a time', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    taskReviewsDb.create(taskId);

    assert.throws(() => taskReviewsDb.create(taskId), /UNIQUE/i);
  });
});

test('a closed review frees the task for a new one', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const first = taskReviewsDb.create(taskId);
    taskReviewsDb.setState(first.review_id, 'approved');

    const second = taskReviewsDb.create(taskId);

    assert.notEqual(second.review_id, first.review_id);
    assert.equal(taskReviewsDb.getLiveByTask(taskId)?.review_id, second.review_id);
  });
});

test('getLiveByTask also finds a review awaiting changes', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const review = taskReviewsDb.create(taskId);
    taskReviewsDb.setState(review.review_id, 'changes_requested');

    assert.equal(taskReviewsDb.getLiveByTask(taskId)?.state, 'changes_requested');
  });
});

test('getWithTask joins the columns the queue renders', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask('Employee form', 'proj-1');
    const review = taskReviewsDb.create(taskId);

    const joined = taskReviewsDb.getWithTask(review.review_id);

    assert.equal(joined?.task_title, 'Employee form');
    assert.equal(joined?.task_project_name, 'proj-1');
    assert.equal(joined?.task_worktree_branch, 'feat/x');
  });
});

test('listWithTask filters by state and project', async () => {
  await withIsolatedDatabase(() => {
    const openReview = taskReviewsDb.create(createTask('A', 'proj-1'));
    const approved = taskReviewsDb.create(createTask('B', 'proj-1'));
    taskReviewsDb.setState(approved.review_id, 'approved');
    taskReviewsDb.create(createTask('C', 'proj-2'));

    const live = taskReviewsDb.listWithTask({ states: ['open', 'changes_requested'] });
    assert.equal(live.length, 2);

    const scoped = taskReviewsDb.listWithTask({ states: ['open'], projectName: 'proj-1' });
    assert.deepEqual(
      scoped.map((row) => row.review_id),
      [openReview.review_id],
    );

    assert.equal(taskReviewsDb.listWithTask().length, 3);
  });
});

test('deleting the task cascades to its reviews and comments', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const review = taskReviewsDb.create(taskId);
    const comment = reviewCommentsDb.create({
      reviewId: review.review_id,
      filePath: 'src/app.ts',
      lineNo: 12,
      body: 'Extract this',
    });

    tasksDb.delete(taskId);

    assert.equal(taskReviewsDb.get(review.review_id), null);
    assert.equal(reviewCommentsDb.get(comment.comment_id), null);
  });
});

test('comments record line, author and state, and resolve in bulk', async () => {
  await withIsolatedDatabase(() => {
    const review = taskReviewsDb.create(createTask());

    const lineComment = reviewCommentsDb.create({
      reviewId: review.review_id,
      filePath: 'src/app.ts',
      lineNo: 42,
      body: 'Validate the CPF here',
    });
    const fileComment = reviewCommentsDb.create({
      reviewId: review.review_id,
      filePath: 'src/app.ts',
      body: 'Whole-file note',
    });
    reviewCommentsDb.create({
      reviewId: review.review_id,
      filePath: 'src/other.ts',
      body: 'Agent reply',
      author: 'agent',
    });

    assert.equal(lineComment.line_no, 42);
    assert.equal(lineComment.author, 'user');
    assert.equal(lineComment.state, 'open');
    assert.equal(fileComment.line_no, null);

    assert.equal(reviewCommentsDb.listByReview(review.review_id).length, 3);
    assert.equal(reviewCommentsDb.listByReviewAndFile(review.review_id, 'src/app.ts').length, 2);

    assert.equal(reviewCommentsDb.resolveAllOpen(review.review_id), 3);
    assert.ok(
      reviewCommentsDb.listByReview(review.review_id).every((row) => row.state === 'resolved'),
    );
  });
});
