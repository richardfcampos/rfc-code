import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import type { ReviewCommentRow, TaskReviewWithTaskRow } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

import { ReviewNotFoundError, ReviewValidationError } from '../reviews.errors.js';
import { createReviewsRouter } from '../reviews.routes.js';
import type { ReviewsService } from '../reviews.service.js';

const REVIEW: TaskReviewWithTaskRow = {
  review_id: 'review-1',
  task_id: 'task-1',
  state: 'open',
  created_at: '2026-08-10T00:00:00.000Z',
  updated_at: '2026-08-10T00:00:00.000Z',
  ai_brief: null,
  task_title: 'Employee form',
  task_project_name: 'project-1',
  task_stage: 'review',
  task_assignee_profile_id: null,
  task_worktree_branch: 'feature/employee-form',
};

const COMMENT: ReviewCommentRow = {
  comment_id: 'comment-1',
  review_id: 'review-1',
  file_path: 'src/app.ts',
  line_no: 12,
  body: 'Validate the CPF here',
  author: 'user',
  state: 'open',
  created_at: '2026-08-10T00:00:00.000Z',
};

function createFakeService(overrides: Partial<ReviewsService> = {}): ReviewsService {
  return {
    openReviewForTask: () => {
      throw new Error('Unexpected openReviewForTask call');
    },
    listQueue: () => {
      throw new Error('Unexpected listQueue call');
    },
    getDetail: async () => {
      throw new Error('Unexpected getDetail call');
    },
    getFileDiff: async () => {
      throw new Error('Unexpected getFileDiff call');
    },
    addComment: async () => {
      throw new Error('Unexpected addComment call');
    },
    generateBrief: async () => {
      throw new Error('Unexpected generateBrief call');
    },
    addCommentForTask: async () => {
      throw new Error('Unexpected addCommentForTask call');
    },
    approve: async () => {
      throw new Error('Unexpected approve call');
    },
    requestChanges: async () => {
      throw new Error('Unexpected requestChanges call');
    },
    ...overrides,
  };
}

async function withReviewsServer(
  service: ReviewsService,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/reviews', createReviewsRouter(service));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.code });
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('GET / returns the queue and passes the filters through', async () => {
  const service = createFakeService({
    listQueue: (query) => {
      assert.deepEqual(query, { state: 'open', project: 'project-1' });
      return [REVIEW];
    },
  });

  await withReviewsServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/reviews?state=open&project=project-1`);
    const payload = (await response.json()) as { data: { reviews: TaskReviewWithTaskRow[] } };

    assert.equal(response.status, 200);
    assert.equal(payload.data.reviews[0].review_id, 'review-1');
  });
});

test('GET /:id/diff forwards the requested file', async () => {
  const service = createFakeService({
    getFileDiff: async (id, file) => {
      assert.equal(id, 'review-1');
      assert.equal(file, 'src/app.ts');
      return {
        file: {
          filePath: 'src/app.ts',
          previousPath: null,
          changeKind: 'modified',
          additions: 3,
          deletions: 1,
        },
        diff: '@@ -1 +1 @@',
      };
    },
  });

  await withReviewsServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/reviews/review-1/diff?file=src%2Fapp.ts`);
    const payload = (await response.json()) as { data: { diff: string } };

    assert.equal(response.status, 200);
    assert.equal(payload.data.diff, '@@ -1 +1 @@');
  });
});

test('POST /:id/comments answers 201 with the routing outcome', async () => {
  const service = createFakeService({
    addComment: async (id, body) => {
      assert.equal(id, 'review-1');
      assert.deepEqual(body, { filePath: 'src/app.ts', lineNo: 12, body: 'Validate the CPF here' });
      return {
        comment: COMMENT,
        routing: { routed: true, status: 'delivered', sessionId: 'session-1' },
      };
    },
  });

  await withReviewsServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/reviews/review-1/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: 'src/app.ts', lineNo: 12, body: 'Validate the CPF here' }),
    });
    const payload = (await response.json()) as { data: { routing: { status: string } } };

    assert.equal(response.status, 201);
    assert.equal(payload.data.routing.status, 'delivered');
  });
});

test('a validation failure becomes a 400 with the named code', async () => {
  const service = createFakeService({
    addComment: async () => {
      throw new ReviewValidationError('body is required');
    },
  });

  await withReviewsServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/reviews/review-1/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: 'src/app.ts' }),
    });

    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { error: string }).error, 'REVIEW_VALIDATION_ERROR');
  });
});

test('an unknown review becomes a 404 with the named code', async () => {
  const service = createFakeService({
    getDetail: async () => {
      throw new ReviewNotFoundError('missing');
    },
  });

  await withReviewsServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/reviews/missing`);

    assert.equal(response.status, 404);
    assert.equal(((await response.json()) as { error: string }).error, 'REVIEW_NOT_FOUND');
  });
});

test('POST /:id/approve returns the merge result', async () => {
  const service = createFakeService({
    approve: async (id, body) => {
      assert.equal(id, 'review-1');
      assert.deepEqual(body, { removeWorktree: true });
      return {
        review: { ...REVIEW, state: 'approved' },
        merge: {
          mergedBranch: 'feature/employee-form',
          targetBranch: 'main',
          squash: false,
          removedWorktree: null,
          cleanupError: null,
        },
        task: null,
        taskUpdateError: null,
      };
    },
  });

  await withReviewsServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/reviews/review-1/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ removeWorktree: true }),
    });
    const payload = (await response.json()) as {
      data: { review: TaskReviewWithTaskRow; merge: { targetBranch: string } };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.data.review.state, 'approved');
    assert.equal(payload.data.merge.targetBranch, 'main');
  });
});

test('POST /:id/request-changes forwards the summary', async () => {
  const service = createFakeService({
    requestChanges: async (id, body) => {
      assert.equal(id, 'review-1');
      assert.deepEqual(body, { body: 'Split this file' });
      return {
        review: { ...REVIEW, state: 'changes_requested' },
        comment: { ...COMMENT, file_path: '', line_no: null },
        routing: { routed: false, status: 'no_session', sessionId: null },
      };
    },
  });

  await withReviewsServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/reviews/review-1/request-changes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Split this file' }),
    });
    const payload = (await response.json()) as {
      data: { review: TaskReviewWithTaskRow; routing: { routed: boolean } };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.data.review.state, 'changes_requested');
    assert.equal(payload.data.routing.routed, false);
  });
});
