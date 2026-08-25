/**
 * Dispatch tests for `review_comment_add`.
 *
 * The bridge's only review tool: the wiring these cover is scope (a task from
 * another project answers 404, exactly like every other task-scoped tool), the
 * task-keyed lookup answering 404 when there is no live review to write to,
 * and the absence of anything that could change a review's state.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AGENT_BRIDGE_TOOL_NAMES, runAgentBridgeTool } from '@/modules/agent-bridge/agent-bridge.tools.js';
import { ReviewNotFoundError } from '@/modules/reviews/index.js';
import { AppError } from '@/shared/utils.js';

import { createBridgeDeps, SCOPE, TASK } from './support/fake-bridge-deps.js';

test('a comment lands on the task\'s live review', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'review_comment_add',
    { taskId: TASK.id, filePath: 'src/app.ts', lineNo: 12, body: 'Validate the CPF here' },
    SCOPE,
    deps,
  )) as { comment: { body: string } };

  assert.deepEqual(deps.reviewCommentCalls, [
    [TASK.id, { filePath: 'src/app.ts', lineNo: 12, body: 'Validate the CPF here' }],
  ]);
  assert.equal(result.comment.body, 'Validate the CPF here');
});

test('an omitted filePath reaches the service as undefined, not an empty string forced here', async () => {
  const deps = createBridgeDeps();

  await runAgentBridgeTool('review_comment_add', { taskId: TASK.id, body: 'Change looks sound.' }, SCOPE, deps);

  const [, body] = deps.reviewCommentCalls[0]!;
  assert.equal(body.filePath, undefined);
  assert.equal(body.lineNo, undefined);
});

test('a task from another project answers 404', async () => {
  const deps = createBridgeDeps();

  const error = await runAgentBridgeTool(
    'review_comment_add',
    { taskId: 'task-from-another-board', body: 'Anything' },
    SCOPE,
    deps,
  ).then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_BRIDGE_TASK_NOT_FOUND');
  assert.equal(error.statusCode, 404);
  assert.equal(deps.reviewCommentCalls.length, 0);
});

test('a task with no live review answers 404', async () => {
  const deps = createBridgeDeps({
    reviews: {
      addCommentForTask: async (taskId) => {
        throw new ReviewNotFoundError(taskId);
      },
    },
  });

  const error = await runAgentBridgeTool(
    'review_comment_add',
    { taskId: TASK.id, body: 'Anything' },
    SCOPE,
    deps,
  ).then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'REVIEW_NOT_FOUND');
  assert.equal(error.statusCode, 404);
});

test('a missing body is refused before the review service is reached', async () => {
  const deps = createBridgeDeps();

  const error = await runAgentBridgeTool('review_comment_add', { taskId: TASK.id }, SCOPE, deps).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_BRIDGE_VALIDATION_ERROR');
  assert.equal(deps.reviewCommentCalls.length, 0);
});

test('the tool list contains no approve-like tool — approval is human-only by construction', () => {
  const approveLike = AGENT_BRIDGE_TOOL_NAMES.filter((name) => /approve|request_changes|review_state/i.test(name));
  assert.deepEqual(approveLike, []);
  assert.ok(AGENT_BRIDGE_TOOL_NAMES.includes('review_comment_add'));
});
