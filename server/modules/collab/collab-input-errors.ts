/**
 * The single shape every rejection on the create path takes.
 *
 * It lives on its own so the rules that use it can be split across files
 * without one of them having to import the other just for an error helper,
 * which is the shortest path to a cycle between them.
 */

import { AppError } from '@/shared/utils.js';

/** A 400 carrying a stable machine-readable code the UI can branch on. */
export function badRequest(message: string, code: string): AppError {
  return new AppError(message, { code, statusCode: 400 });
}
