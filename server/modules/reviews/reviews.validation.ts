/**
 * Field-level validation for the Reviews module.
 *
 * Nothing here is ever interpolated into a shell, but the diff endpoints do
 * pass a file path to `git`, so these parsers reject the forms git would read
 * as an option or as a traversal before the value travels any further. The
 * service additionally requires the path to appear in the review's own file
 * list, so validation is defense in depth rather than the only gate.
 */

import type { TaskReviewState } from '@/modules/database/index.js';

import { ReviewValidationError } from './reviews.errors.js';

export const REVIEW_STATES: TaskReviewState[] = ['open', 'approved', 'changes_requested', 'closed'];

export const COMMENT_BODY_MAX_LENGTH = 10_000;
export const FILE_PATH_MAX_LENGTH = 1_024;

export function requireReviewId(rawId: unknown): string {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) {
    throw new ReviewValidationError('review id is required');
  }
  return id;
}

export function validateCommentBody(rawBody: unknown): string {
  const body = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (!body) {
    throw new ReviewValidationError('body is required');
  }
  if (body.length > COMMENT_BODY_MAX_LENGTH) {
    throw new ReviewValidationError(`body must be at most ${COMMENT_BODY_MAX_LENGTH} characters`);
  }
  return body;
}

/** A repository-relative path, in the form git prints in `diff --name-status`. */
export function validateDiffFilePath(rawPath: unknown): string {
  const filePath = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!filePath) {
    throw new ReviewValidationError('file is required');
  }
  if (filePath.length > FILE_PATH_MAX_LENGTH) {
    throw new ReviewValidationError(`file must be at most ${FILE_PATH_MAX_LENGTH} characters`);
  }
  if (
    filePath.includes('\0') ||
    filePath.startsWith('-') ||
    filePath.startsWith('/') ||
    filePath.split('/').includes('..')
  ) {
    throw new ReviewValidationError('file is not a valid repository-relative path');
  }
  return filePath;
}

/** Line numbers are optional: a comment without one is about the file as a whole. */
export function validateLineNumber(rawLineNo: unknown): number | null {
  if (rawLineNo === undefined || rawLineNo === null) {
    return null;
  }
  const lineNo = typeof rawLineNo === 'number' ? rawLineNo : Number.NaN;
  if (!Number.isInteger(lineNo) || lineNo < 1) {
    throw new ReviewValidationError('lineNo must be a positive integer');
  }
  return lineNo;
}

/** Parses the queue endpoint's optional comma-separated `state` filter. */
export function validateStateFilter(rawStates: unknown): TaskReviewState[] | undefined {
  if (rawStates === undefined || rawStates === null || rawStates === '') {
    return undefined;
  }
  if (typeof rawStates !== 'string') {
    throw new ReviewValidationError('state must be a comma-separated list of review states');
  }

  const states = rawStates
    .split(',')
    .map((state) => state.trim())
    .filter((state) => state.length > 0);

  for (const state of states) {
    if (!REVIEW_STATES.includes(state as TaskReviewState)) {
      throw new ReviewValidationError(`state must be one of: ${REVIEW_STATES.join(', ')}`);
    }
  }

  return states.length > 0 ? (states as TaskReviewState[]) : undefined;
}

export function validateOptionalProject(rawProject: unknown): string | undefined {
  if (rawProject === undefined || rawProject === null || rawProject === '') {
    return undefined;
  }
  if (typeof rawProject !== 'string' || !rawProject.trim()) {
    throw new ReviewValidationError('project must be a non-empty string');
  }
  return rawProject.trim();
}
