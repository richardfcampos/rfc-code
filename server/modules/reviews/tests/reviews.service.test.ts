import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, taskReviewsDb, tasksDb } from '@/modules/database/index.js';
import type { SessionRow, TaskRow } from '@/modules/database/index.js';
import { mergeWorktree, removeWorktree } from '@/modules/worktrees/index.js';
import { runGitCommand } from '@/shared/git-command.js';
import { AppError } from '@/shared/utils.js';

import type { ReviewUpdateAction } from '../review-update-broadcast.js';
import { createReviewsService, type ReviewsService } from '../reviews.service.js';
import type { SessionMessageSender } from '../services/review-comment-delivery.service.js';

import { createScriptedRepository, type ScriptedRepository } from './scripted-git-repository.js';

type Harness = {
  service: ReviewsService;
  repository: ScriptedRepository;
  task: TaskRow;
  broadcasts: ReviewUpdateAction[];
  sentMessages: Array<{ sessionId: string; text: string }>;
  sessions: SessionRow[];
  setSender(sender: SessionMessageSender | null): void;
};

function buildSession(overrides: Partial<SessionRow>): SessionRow {
  return {
    session_id: 'session-1',
    provider: 'claude',
    provider_session_id: 'provider-1',
    project_path: '/repo',
    jsonl_path: null,
    custom_name: null,
    profile_id: null,
    caveman_mode: null,
    isArchived: 0,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    worktree_path: null,
    worktree_branch: null,
    seed_primer_path: null,
    ...overrides,
  };
}

/**
 * One isolated database, one scripted repository with a feature branch that
 * already carries a commit, and a service wired to both.
 */
async function withHarness(runTest: (harness: Harness) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'reviews-service-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(databaseDirectory, 'auth.db');
  await initializeDatabase();

  const repository = await createScriptedRepository();
  await repository.commitFile(
    repository.worktreePath,
    'employee-form.ts',
    'export const cpf = "000";\n',
    'feat: employee form',
  );

  const broadcasts: ReviewUpdateAction[] = [];
  const sentMessages: Array<{ sessionId: string; text: string }> = [];
  const sessions: SessionRow[] = [];
  let sender: SessionMessageSender | null = null;

  const task = tasksDb.create({
    title: 'Employee form',
    projectName: 'project-1',
    worktreeBranch: repository.branch,
  });

  const service = createReviewsService({
    runGit: runGitCommand,
    getTaskById: (taskId) => tasksDb.get(taskId),
    getProjectPathById: (projectId) => (projectId === 'project-1' ? repository.root : null),
    setTaskStage: async (taskId, stage) => {
      const updated = tasksDb.update(taskId, { stage });
      if (!updated) {
        throw new Error(`task ${taskId} vanished`);
      }
      return updated;
    },
    mergeWorktree: (input) =>
      mergeWorktree(input, {
        runGit: runGitCommand,
        removeWorktree: (removeInput) =>
          removeWorktree(removeInput, {
            runGit: runGitCommand,
            projects: { getProjectByPath: () => null, archiveProject: async () => {} },
          }),
      }),
    delivery: {
      listSessionsByProjectPath: () => sessions,
      get sendSessionMessage() {
        return sender;
      },
    },
    broadcast: (_review, action) => {
      broadcasts.push(action);
    },
  });

  try {
    await runTest({
      service,
      repository,
      task,
      broadcasts,
      sentMessages,
      sessions,
      setSender: (next) => {
        sender = next;
      },
    });
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

/** Records every routed message so tests can assert on delivery. */
function recordingSender(sent: Array<{ sessionId: string; text: string }>): SessionMessageSender {
  return async ({ session, text }) => {
    sent.push({ sessionId: session.session_id, text });
    return true;
  };
}

test('a task reaching review opens exactly one review', async () => {
  await withHarness(async ({ service, task, broadcasts }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' });

    assert.ok(review);
    assert.equal(review.state, 'open');
    assert.deepEqual(broadcasts, ['opened']);

    // Moving the card out and back must reuse the same thread.
    const again = service.openReviewForTask({ ...task, stage: 'review' });
    assert.equal(again?.review_id, review.review_id);
    assert.deepEqual(broadcasts, ['opened', 'updated']);
  });
});

test('re-entering review reopens a thread that was awaiting changes', async () => {
  await withHarness(async ({ service, task }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' });
    taskReviewsDb.setState(review!.review_id, 'changes_requested');

    const reopened = service.openReviewForTask({ ...task, stage: 'review' });

    assert.equal(reopened?.review_id, review!.review_id);
    assert.equal(reopened?.state, 'open');
  });
});

test('a task with no worktree branch opens no review', async () => {
  await withHarness(async ({ service, task, broadcasts }) => {
    const review = service.openReviewForTask({ ...task, worktree_branch: null, stage: 'review' });

    assert.equal(review, null);
    assert.deepEqual(broadcasts, []);
  });
});

test('the detail view reports the branch, the base and the changed files', async () => {
  await withHarness(async ({ service, task, repository }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' })!;

    const detail = await service.getDetail(review.review_id);

    assert.equal(detail.worktree.branch, repository.branch);
    assert.equal(detail.worktree.baseBranch, repository.baseBranch);
    assert.deepEqual(
      detail.files.map((file) => [file.filePath, file.changeKind, file.additions]),
      [['employee-form.ts', 'added', 1]],
    );
    assert.deepEqual(detail.comments, []);
  });
});

test('a file diff is returned for a file in the review and refused otherwise', async () => {
  await withHarness(async ({ service, task }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' })!;

    const { diff, file } = await service.getFileDiff(review.review_id, 'employee-form.ts');
    assert.equal(file.changeKind, 'added');
    assert.match(diff, /\+export const cpf/);

    await assert.rejects(
      () => service.getFileDiff(review.review_id, 'README.md'),
      (error: AppError) => error.code === 'REVIEW_FILE_NOT_IN_DIFF',
    );
  });
});

test('a comment is persisted even when no session can take it', async () => {
  await withHarness(async ({ service, task, broadcasts }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' })!;

    const { comment, routing } = await service.addComment(review.review_id, {
      filePath: 'employee-form.ts',
      lineNo: 1,
      body: 'Validate the CPF here',
    });

    assert.equal(comment.line_no, 1);
    assert.equal(comment.author, 'user');
    assert.equal(routing.routed, false);
    assert.equal(routing.status, 'no_session');
    assert.ok(broadcasts.includes('commented'));

    const detail = await service.getDetail(review.review_id);
    assert.equal(detail.comments.length, 1);
  });
});

test('a comment is routed to the session working on the task branch', async () => {
  await withHarness(async ({ service, task, repository, sessions, sentMessages, setSender }) => {
    sessions.push(
      buildSession({ session_id: 'other', worktree_branch: 'feature/unrelated' }),
      buildSession({
        session_id: 'author',
        worktree_branch: repository.branch,
        worktree_path: repository.worktreePath,
      }),
    );
    setSender(recordingSender(sentMessages));

    const review = service.openReviewForTask({ ...task, stage: 'review' })!;
    const { routing } = await service.addComment(review.review_id, {
      filePath: 'employee-form.ts',
      lineNo: 3,
      body: 'Validate the CPF here',
    });

    assert.equal(routing.routed, true);
    assert.equal(routing.status, 'delivered');
    assert.equal(routing.sessionId, 'author');
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /employee-form\.ts:3/);
    assert.match(sentMessages[0].text, /Validate the CPF here/);
  });
});

test('a busy session leaves the comment persisted and reported as not routed', async () => {
  await withHarness(async ({ service, task, repository, sessions, setSender }) => {
    sessions.push(buildSession({ session_id: 'author', worktree_branch: repository.branch }));
    setSender(async () => false);

    const review = service.openReviewForTask({ ...task, stage: 'review' })!;
    const { routing } = await service.addComment(review.review_id, {
      filePath: 'employee-form.ts',
      body: 'Please rename this',
    });

    assert.deepEqual(
      { routed: routing.routed, status: routing.status },
      { routed: false, status: 'session_busy' },
    );
  });
});

test('a sender that throws never fails the comment', async () => {
  await withHarness(async ({ service, task, repository, sessions, setSender }) => {
    sessions.push(buildSession({ session_id: 'author', worktree_branch: repository.branch }));
    setSender(async () => {
      throw new Error('runtime exploded');
    });

    const review = service.openReviewForTask({ ...task, stage: 'review' })!;
    const { comment, routing } = await service.addComment(review.review_id, {
      filePath: 'employee-form.ts',
      body: 'Please rename this',
    });

    assert.ok(comment.comment_id);
    assert.equal(routing.status, 'failed');
  });
});

test('approving merges the branch, closes the review and moves the task to done', async () => {
  await withHarness(async ({ service, task, repository }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' })!;
    await service.addComment(review.review_id, { filePath: 'employee-form.ts', body: 'nit' });

    const result = await service.approve(review.review_id, {});

    assert.equal(result.merge.mergedBranch, repository.branch);
    assert.equal(result.merge.targetBranch, repository.baseBranch);
    assert.equal(result.review.state, 'approved');
    assert.equal(result.task?.stage, 'done');
    assert.equal(result.taskUpdateError, null);

    const { stdout } = await runGitCommand(['log', '--format=%s', '-3'], repository.root);
    assert.match(stdout, /feat: employee form/);

    const detail = await service.getDetail(review.review_id);
    assert.ok(detail.comments.every((comment) => comment.state === 'resolved'));
  });
});

test('a conflicting merge is aborted and the review stays open', async () => {
  await withHarness(async ({ service, task, repository }) => {
    // Both branches touch the same file with different content.
    await repository.commitFile(
      repository.worktreePath,
      'conflict.txt',
      'from the branch\n',
      'feat: branch line',
    );
    await repository.commitFile(
      repository.root,
      'conflict.txt',
      'from the base\n',
      'feat: base line',
    );

    const review = service.openReviewForTask({ ...task, stage: 'review' })!;

    await assert.rejects(
      () => service.approve(review.review_id, {}),
      (error: AppError) => error.code === 'WORKTREE_MERGE_CONFLICT' && error.statusCode === 409,
    );

    assert.equal(taskReviewsDb.get(review.review_id)?.state, 'open');
    assert.equal(tasksDb.get(task.id)?.stage, 'backlog');
  });
});

test('approving twice is refused', async () => {
  await withHarness(async ({ service, task }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' })!;
    await service.approve(review.review_id, {});

    await assert.rejects(
      () => service.approve(review.review_id, {}),
      (error: AppError) => error.code === 'REVIEW_STATE_INVALID',
    );
  });
});

test('requesting changes flips the state and routes the summary', async () => {
  await withHarness(async ({ service, task, repository, sessions, sentMessages, setSender }) => {
    sessions.push(buildSession({ session_id: 'author', worktree_branch: repository.branch }));
    setSender(recordingSender(sentMessages));

    const review = service.openReviewForTask({ ...task, stage: 'review' })!;
    const result = await service.requestChanges(review.review_id, { body: 'Split this file' });

    assert.equal(result.review.state, 'changes_requested');
    assert.equal(result.comment?.file_path, '');
    assert.equal(result.routing?.status, 'delivered');
    assert.match(sentMessages[0].text, /Split this file/);
  });
});

test('requesting changes without a summary writes no comment', async () => {
  await withHarness(async ({ service, task }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' })!;

    const result = await service.requestChanges(review.review_id, {});

    assert.equal(result.review.state, 'changes_requested');
    assert.equal(result.comment, null);
    assert.equal(result.routing, null);
  });
});

test('a review whose branch has no worktree cannot be opened for detail', async () => {
  await withHarness(async ({ service, task, repository }) => {
    const review = service.openReviewForTask({ ...task, stage: 'review' })!;
    await runGitCommand(['worktree', 'remove', repository.worktreePath], repository.root);

    await assert.rejects(
      () => service.getDetail(review.review_id),
      (error: AppError) => error.code === 'REVIEW_WORKTREE_MISSING',
    );
  });
});

test('an unknown review id is a 404', async () => {
  await withHarness(async ({ service }) => {
    await assert.rejects(
      () => service.getDetail('missing'),
      (error: AppError) => error.code === 'REVIEW_NOT_FOUND' && error.statusCode === 404,
    );
  });
});
