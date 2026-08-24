/**
 * Named failures of the Reviews module: `server/modules/reviews`.
 *
 * All extend the shared `AppError`, so the global error middleware maps them
 * to a status and a `{ success: false, error: { code, message } }` body
 * without any route-level branching.
 */

import { AppError } from '@/shared/utils.js';

export class ReviewValidationError extends AppError {
  constructor(message: string) {
    super(message, { code: 'REVIEW_VALIDATION_ERROR', statusCode: 400 });
    this.name = 'ReviewValidationError';
  }
}

export class ReviewNotFoundError extends AppError {
  constructor(id: string) {
    super(`Review "${id}" not found`, { code: 'REVIEW_NOT_FOUND', statusCode: 404 });
    this.name = 'ReviewNotFoundError';
  }
}

/** The review's task disappeared, or its project no longer resolves to a path. */
export class ReviewTaskUnresolvedError extends AppError {
  constructor(message: string) {
    super(message, { code: 'REVIEW_TASK_UNRESOLVED', statusCode: 404 });
    this.name = 'ReviewTaskUnresolvedError';
  }
}

/**
 * The task has no branch, or the branch it names is not a live worktree of the
 * project's repository. Every git argument this module passes comes from the
 * repository's own `worktree list`, so an unmatched branch stops here rather
 * than reaching git.
 */
export class ReviewWorktreeMissingError extends AppError {
  constructor(message: string) {
    super(message, { code: 'REVIEW_WORKTREE_MISSING', statusCode: 409 });
    this.name = 'ReviewWorktreeMissingError';
  }
}

/** The review is in a state that does not accept the requested transition. */
export class ReviewStateError extends AppError {
  constructor(message: string) {
    super(message, { code: 'REVIEW_STATE_INVALID', statusCode: 409 });
    this.name = 'ReviewStateError';
  }
}

/** The requested file is not part of this review's diff. */
export class ReviewFileNotInDiffError extends AppError {
  constructor(filePath: string) {
    super(`"${filePath}" is not part of this review's diff`, {
      code: 'REVIEW_FILE_NOT_IN_DIFF',
      statusCode: 404,
    });
    this.name = 'ReviewFileNotInDiffError';
  }
}
