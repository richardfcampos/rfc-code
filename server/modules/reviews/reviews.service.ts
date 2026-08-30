/**
 * Application service for the Review Center: `server/modules/reviews`.
 *
 * A review is the human gate between "an agent says it is done" and "the work
 * is on the base branch": it opens by itself when a task with a worktree
 * reaches the Review column, carries the diff and the per-line conversation,
 * and ends either as an approved merge or as changes routed back to the agent.
 */

import {
  reviewCommentsDb,
  taskReviewsDb,
  type ReviewCommentAuthor,
  type ReviewCommentRow,
  type TaskReviewRow,
  type TaskReviewState,
  type TaskReviewWithTaskRow,
  type TaskRow,
} from '@/modules/database/index.js';
import type { GitCommandRunner, MergeWorktreeInput, MergeWorktreeResult } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import type { ReviewUpdateAction } from './review-update-broadcast.js';
import { ReviewNotFoundError, ReviewStateError } from './reviews.errors.js';
import {
  requireReviewId,
  validateCommentBody,
  validateDiffFilePath,
  validateLineNumber,
  validateOptionalProject,
  validateStateFilter,
} from './reviews.validation.js';
import {
  routeCommentToAuthorSession,
  type ReviewCommentDeliveryDeps,
  type ReviewCommentRouting,
} from './services/review-comment-delivery.service.js';
import { resolveReviewContext, type ReviewContext } from './services/review-context.service.js';
import {
  listReviewDiffFiles,
  readReviewFileDiff,
  type ReviewDiffFile,
} from './services/review-diff.service.js';

export type ReviewsServiceDeps = {
  runGit: GitCommandRunner;
  getTaskById: (taskId: string) => TaskRow | null;
  getProjectPathById: (projectId: string) => string | null;
  /** Moves the task to another column, announcing it like any board mutation. */
  setTaskStage: (taskId: string, stage: TaskRow['stage']) => Promise<TaskRow>;
  mergeWorktree: (input: MergeWorktreeInput) => Promise<MergeWorktreeResult>;
  delivery: ReviewCommentDeliveryDeps;
  broadcast: (review: TaskReviewWithTaskRow, action: ReviewUpdateAction) => void;
  /**
   * One-shot LLM call used for the AI brief. Installed at boot like the
   * session runtime; null until then, and the brief endpoint reports that
   * instead of failing silently.
   */
  generateText?: ((prompt: string, options: { cwd: string }) => Promise<string>) | null;
};

export type ReviewDetail = {
  review: TaskReviewWithTaskRow;
  task: TaskRow;
  worktree: { repositoryRoot: string; worktreePath: string; branch: string; baseBranch: string };
  files: ReviewDiffFile[];
  comments: ReviewCommentRow[];
};

export type ReviewCommentResult = { comment: ReviewCommentRow; routing: ReviewCommentRouting };

export type ReviewApprovalResult = {
  review: TaskReviewWithTaskRow;
  merge: MergeWorktreeResult;
  task: TaskRow | null;
  /** Set when the merge landed but the board move failed; the merge stands. */
  taskUpdateError: string | null;
};

export type ReviewsService = {
  openReviewForTask(task: TaskRow): TaskReviewRow | null;
  listQueue(query: { state?: unknown; project?: unknown }): TaskReviewWithTaskRow[];
  getDetail(rawId: unknown): Promise<ReviewDetail>;
  getFileDiff(rawId: unknown, rawFile: unknown): Promise<{ file: ReviewDiffFile; diff: string }>;
  addComment(rawId: unknown, body: Record<string, unknown>): Promise<ReviewCommentResult>;
  /**
   * The bridge's write path: an agent knows its task, not the review's
   * internal id, so the live review is resolved server-side.
   */
  addCommentForTask(taskId: string, body: Record<string, unknown>): Promise<ReviewCommentResult>;
  generateBrief(rawId: unknown): Promise<{ review: TaskReviewWithTaskRow }>;
  approve(rawId: unknown, body: Record<string, unknown>): Promise<ReviewApprovalResult>;
  requestChanges(
    rawId: unknown,
    body: Record<string, unknown>,
  ): Promise<{ review: TaskReviewWithTaskRow; comment: ReviewCommentRow | null; routing: ReviewCommentRouting | null }>;
};

const LIVE_STATES: TaskReviewState[] = ['open', 'changes_requested'];

function requireReview(reviewId: string): TaskReviewRow {
  const review = taskReviewsDb.get(reviewId);
  if (!review) {
    throw new ReviewNotFoundError(reviewId);
  }
  return review;
}

/** Re-reads the joined row a broadcast and every response body carry. */
function requireJoinedReview(reviewId: string): TaskReviewWithTaskRow {
  const joined = taskReviewsDb.getWithTask(reviewId);
  if (!joined) {
    throw new ReviewNotFoundError(reviewId);
  }
  return joined;
}

function requireLiveReview(reviewId: string): TaskReviewRow {
  const review = requireReview(reviewId);
  if (!LIVE_STATES.includes(review.state)) {
    throw new ReviewStateError(`Review "${reviewId}" is already ${review.state}`);
  }
  return review;
}

async function loadContext(deps: ReviewsServiceDeps, review: TaskReviewRow): Promise<ReviewContext> {
  return resolveReviewContext(review, {
    runGit: deps.runGit,
    getTaskById: deps.getTaskById,
    getProjectPathById: deps.getProjectPathById,
  });
}

/**
 * Opens the review for a task that just reached the Review column.
 *
 * Idempotent by design — the stage listener can fire again for the same card
 * (moved out and back), and the database allows only one live review per task,
 * so an existing thread is reused instead of forked. Tasks with no worktree
 * branch have nothing to diff and are skipped.
 */
function openReviewForTask(deps: ReviewsServiceDeps, task: TaskRow): TaskReviewRow | null {
  if (!task.worktree_branch) {
    return null;
  }

  const existing = taskReviewsDb.getLiveByTask(task.id);
  if (existing) {
    // Re-entering Review after changes were requested puts the card back in
    // the queue as freshly open.
    const review =
      existing.state === 'changes_requested'
        ? taskReviewsDb.setState(existing.review_id, 'open') ?? existing
        : existing;
    deps.broadcast(requireJoinedReview(review.review_id), 'updated');
    return review;
  }

  const review = taskReviewsDb.create(task.id);
  deps.broadcast(requireJoinedReview(review.review_id), 'opened');
  return review;
}

function listQueue(query: { state?: unknown; project?: unknown }): TaskReviewWithTaskRow[] {
  return taskReviewsDb.listWithTask({
    // Default view is the work still waiting on a human.
    states: validateStateFilter(query.state) ?? LIVE_STATES,
    projectName: validateOptionalProject(query.project),
  });
}

async function getDetail(deps: ReviewsServiceDeps, rawId: unknown): Promise<ReviewDetail> {
  const reviewId = requireReviewId(rawId);
  const context = await loadContext(deps, requireReview(reviewId));

  return {
    review: requireJoinedReview(reviewId),
    task: context.task,
    worktree: {
      repositoryRoot: context.repositoryRoot,
      worktreePath: context.worktreePath,
      branch: context.branch,
      baseBranch: context.baseBranch,
    },
    files: await listReviewDiffFiles(context, deps.runGit),
    comments: reviewCommentsDb.listByReview(reviewId),
  };
}

/** Caps that keep the brief prompt inside a single ephemeral query. */
const BRIEF_MAX_FILES = 10;
const BRIEF_MAX_DIFF_CHARS_PER_FILE = 1200;

/**
 * Writes (or rewrites) the review's AI brief: what changed, risks, and a UAT
 * checklist, distilled from the branch diff. Persisted on the review row so
 * reopening the cockpit does not pay for another generation.
 */
async function generateBrief(
  deps: ReviewsServiceDeps,
  rawId: unknown,
): Promise<{ review: TaskReviewWithTaskRow }> {
  const reviewId = requireReviewId(rawId);
  const generate = deps.generateText;
  if (!generate) {
    throw new AppError('AI brief generation is not available on this server', {
      code: 'BRIEF_NOT_CONFIGURED',
      statusCode: 503,
    });
  }

  const context = await loadContext(deps, requireReview(reviewId));
  const files = await listReviewDiffFiles(context, deps.runGit);

  let diffContext = '';
  for (const file of files.slice(0, BRIEF_MAX_FILES)) {
    try {
      const { diff } = await readReviewFileDiff(context, file.filePath, deps.runGit);
      diffContext += `\n--- ${file.filePath} (+${file.additions} -${file.deletions})\n${diff.slice(0, BRIEF_MAX_DIFF_CHARS_PER_FILE)}\n`;
    } catch {
      // Binary or vanished mid-read — the file list line still names it.
    }
  }

  const prompt = `Você prepara o resumo de um code review para o dono do projeto decidir rápido. Responda em português do Brasil, em markdown curto, EXATAMENTE nesta estrutura, sem nada antes ou depois:

## O que mudou
(3 a 6 bullets, foco no comportamento visível para o usuário)

## Riscos
(bullets; se nenhum, escreva "Nenhum risco relevante identificado")

## Checklist de UAT
(3 a 6 passos concretos de clique/verificação com o app rodando; se a mudança não for testável pela UI, diga o que verificar em vez disso)

TAREFA: ${context.task.title}
DESCRIÇÃO: ${context.task.description ?? '(sem descrição)'}
BRANCH: ${context.branch} → ${context.baseBranch}
ARQUIVOS ALTERADOS (${files.length}):
${files.map((file) => `- ${file.filePath} (+${file.additions} -${file.deletions})`).join('\n')}

DIFFS (parciais):
${diffContext}`;

  const brief = (await generate(prompt, { cwd: context.worktreePath })).trim();
  taskReviewsDb.setBrief(reviewId, brief);

  const review = requireJoinedReview(reviewId);
  deps.broadcast(review, 'updated');
  return { review };
}

async function getFileDiff(
  deps: ReviewsServiceDeps,
  rawId: unknown,
  rawFile: unknown,
): Promise<{ file: ReviewDiffFile; diff: string }> {
  const reviewId = requireReviewId(rawId);
  const filePath = validateDiffFilePath(rawFile);
  const context = await loadContext(deps, requireReview(reviewId));
  return readReviewFileDiff(context, filePath, deps.runGit);
}

/**
 * A comment's file path is optional: empty is a review-wide comment, the same
 * shape `requestChanges` already writes (`reviewCommentsDb` stores `''`).
 * `validateDiffFilePath` stays strict for the one caller that must always
 * name a real file (`getFileDiff`), so the "optional" reading lives here
 * instead of loosening that check for every caller.
 */
function normalizeCommentFilePath(rawFilePath: unknown): string {
  if (rawFilePath === undefined || rawFilePath === null || rawFilePath === '') {
    return '';
  }
  return validateDiffFilePath(rawFilePath);
}

/**
 * Persists a comment and then tries to page the author's session with it.
 *
 * The write happens first and unconditionally: routing is best effort and its
 * outcome is reported, never thrown. `author` defaults to `user` — the human
 * REST route never passes one — and is the only thing that separates this
 * from the bridge's write path below.
 */
async function addComment(
  deps: ReviewsServiceDeps,
  rawId: unknown,
  body: Record<string, unknown>,
  author: ReviewCommentAuthor = 'user',
): Promise<ReviewCommentResult> {
  const reviewId = requireReviewId(rawId);
  const review = requireLiveReview(reviewId);
  const filePath = normalizeCommentFilePath(body.filePath);
  const lineNo = validateLineNumber(body.lineNo);
  const commentBody = validateCommentBody(body.body);

  const context = await loadContext(deps, review);
  const comment = reviewCommentsDb.create({ reviewId, filePath, lineNo, body: commentBody, author });
  taskReviewsDb.touch(reviewId);
  deps.broadcast(requireJoinedReview(reviewId), 'commented');

  const routing = await routeCommentToAuthorSession(
    { comment, task: context.task, repositoryRoot: context.repositoryRoot, branch: context.branch },
    deps.delivery,
  );

  return { comment, routing };
}

/**
 * The bridge's write path, keyed by task rather than review id: the live
 * review is the same lookup `openReviewForTask` uses, so a task with no
 * review right now — never opened, or already closed — answers 404 instead
 * of writing a comment nobody is waiting on.
 */
async function addCommentForTask(
  deps: ReviewsServiceDeps,
  taskId: string,
  body: Record<string, unknown>,
): Promise<ReviewCommentResult> {
  const review = taskReviewsDb.getLiveByTask(taskId);
  if (!review) {
    throw new ReviewNotFoundError(taskId);
  }
  return addComment(deps, review.review_id, body, 'agent');
}

/**
 * Names a merge failure the way the thread should read it: the error's own
 * message, plus the conflicted paths when the failure carried any (only
 * `WORKTREE_MERGE_CONFLICT` does — other merge failures show just the message).
 */
function describeMergeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const conflictedPaths =
    error instanceof AppError && Array.isArray(error.details)
      ? error.details.filter((entry): entry is string => typeof entry === 'string')
      : [];

  if (conflictedPaths.length === 0) {
    return message;
  }
  return [message, 'Conflicted files:', ...conflictedPaths.map((filePath) => `- ${filePath}`)].join('\n');
}

/**
 * Writes a merge failure into the thread and pages the author, so the reason
 * a conflict aborted survives a dismissed dialog instead of existing only in
 * the HTTP response.
 *
 * Best effort and swallowed on failure by contract: this reports a merge
 * error, so it must never throw one of its own and mask the original.
 */
async function recordMergeFailure(
  deps: ReviewsServiceDeps,
  context: ReviewContext,
  reviewId: string,
  error: unknown,
): Promise<void> {
  try {
    // Review-wide comment: empty path, the same shape `requestChanges` writes.
    const comment = reviewCommentsDb.create({
      reviewId,
      filePath: '',
      lineNo: null,
      body: `The merge could not be completed:\n\n${describeMergeFailure(error)}`,
    });
    taskReviewsDb.touch(reviewId);
    deps.broadcast(requireJoinedReview(reviewId), 'commented');
    await routeCommentToAuthorSession(
      { comment, task: context.task, repositoryRoot: context.repositoryRoot, branch: context.branch },
      deps.delivery,
    );
  } catch (recordError) {
    console.error('[reviews] could not record a merge failure on the review:', recordError);
  }
}

/**
 * Merges the review's branch into the base branch, then closes the loop.
 *
 * The merge runs first and decides everything: on conflict the worktree merge
 * service aborts and rolls the base worktree back, its typed error propagates,
 * and the review stays exactly where it was so the same button can be pressed
 * again after the conflict is resolved. A failed merge is also recorded as a
 * comment before the error propagates, so the reason is not lost with the
 * HTTP response that carried it.
 */
async function approve(
  deps: ReviewsServiceDeps,
  rawId: unknown,
  body: Record<string, unknown>,
): Promise<ReviewApprovalResult> {
  const reviewId = requireReviewId(rawId);
  const context = await loadContext(deps, requireLiveReview(reviewId));

  let merge: MergeWorktreeResult;
  try {
    merge = await deps.mergeWorktree({
      projectPath: context.repositoryRoot,
      worktreePath: context.worktreePath,
      squash: body.squash === true,
      message: typeof body.message === 'string' ? body.message : null,
      removeAfterMerge: body.removeWorktree === true,
    });
  } catch (error) {
    await recordMergeFailure(deps, context, reviewId, error);
    throw error;
  }

  taskReviewsDb.setState(reviewId, 'approved');
  reviewCommentsDb.resolveAllOpen(reviewId);

  // The merge already landed, so a failure to move the card must not be
  // reported as a failed approval — it is surfaced alongside the result.
  let task: TaskRow | null = null;
  let taskUpdateError: string | null = null;
  try {
    task = await deps.setTaskStage(context.task.id, 'done');
  } catch (error) {
    taskUpdateError = error instanceof Error ? error.message : String(error);
    console.error('[reviews] merged an approved review but could not move the task:', error);
  }

  const review = requireJoinedReview(reviewId);
  deps.broadcast(review, 'closed');
  return { review, merge, task, taskUpdateError };
}

/**
 * Sends the review back to the agent: state flips and the optional summary is
 * routed like any other comment.
 */
async function requestChanges(
  deps: ReviewsServiceDeps,
  rawId: unknown,
  body: Record<string, unknown>,
): Promise<{
  review: TaskReviewWithTaskRow;
  comment: ReviewCommentRow | null;
  routing: ReviewCommentRouting | null;
}> {
  const reviewId = requireReviewId(rawId);
  const review = requireLiveReview(reviewId);
  const hasSummary = body.body !== undefined && body.body !== null && body.body !== '';
  const summary = hasSummary ? validateCommentBody(body.body) : null;

  const context = await loadContext(deps, review);
  taskReviewsDb.setState(reviewId, 'changes_requested');

  let comment: ReviewCommentRow | null = null;
  let routing: ReviewCommentRouting | null = null;
  if (summary) {
    // Review-wide comments carry an empty path: they belong to no single file.
    comment = reviewCommentsDb.create({ reviewId, filePath: '', lineNo: null, body: summary });
    routing = await routeCommentToAuthorSession(
      { comment, task: context.task, repositoryRoot: context.repositoryRoot, branch: context.branch },
      deps.delivery,
    );
  }

  const joined = requireJoinedReview(reviewId);
  deps.broadcast(joined, 'updated');
  return { review: joined, comment, routing };
}

/** Composition root for the Reviews application service. */
export function createReviewsService(deps: ReviewsServiceDeps): ReviewsService {
  return {
    openReviewForTask: (task) => openReviewForTask(deps, task),
    listQueue: (query) => listQueue(query),
    getDetail: (id) => getDetail(deps, id),
    getFileDiff: (id, file) => getFileDiff(deps, id, file),
    addComment: (id, body) => addComment(deps, id, body),
    addCommentForTask: (taskId, body) => addCommentForTask(deps, taskId, body),
    generateBrief: (id) => generateBrief(deps, id),
    approve: (id, body) => approve(deps, id, body),
    requestChanges: (id, body) => requestChanges(deps, id, body),
  };
}
