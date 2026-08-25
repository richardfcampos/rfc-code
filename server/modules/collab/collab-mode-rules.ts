/**
 * What each collaboration mode requires of a request, separate from what a
 * participant requires of itself.
 *
 * The three modes differ in who sees what, in what order, and when to stop —
 * and those differences reach the request as constraints on the round ceiling
 * and on the roles. Keeping them together means the answer to "what does review
 * mode actually demand?" is one file, not a search through participant parsing.
 */

import { badRequest } from './collab-input-errors.js';
import type { CollabMode, CollabParticipant } from './collab.types.js';

const MIN_ROUNDS = 1;
const MAX_ROUNDS = 5;
const DEFAULT_ROUNDS = 3;
const REVIEW_ROLES = ['author', 'reviewer'];
const MODES: readonly CollabMode[] = ['debate', 'review', 'vote', 'council'];

export function readMode(value: unknown): CollabMode {
  if (typeof value === 'string' && (MODES as readonly string[]).includes(value)) {
    return value as CollabMode;
  }
  throw badRequest(
    `Unsupported collaboration mode "${String(value)}". Expected ${MODES.join(', ')}.`,
    'INVALID_MODE',
  );
}

function readRoundCeiling(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_ROUNDS;

  const rounds = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw badRequest(
      `maxRounds must be a whole number between ${MIN_ROUNDS} and ${MAX_ROUNDS}.`,
      'INVALID_MAX_ROUNDS',
    );
  }
  return rounds;
}

/**
 * A vote is one blind answer per account compared by an arbiter: a second round
 * would have nothing new to react to, so a ceiling sent for a vote is coerced to
 * one instead of rejected. What was sent is still validated first — silently
 * accepting `"banana"` because the mode ignores it would let the same payload
 * fail only when the caller switches to debate.
 */
export function readMaxRounds(value: unknown, mode: CollabMode): number {
  const requested = readRoundCeiling(value);
  return mode === 'vote' ? 1 : requested;
}

export function assertReviewRoles(participants: CollabParticipant[]): void {
  const roles = participants.map((participant) => participant.role);
  const paired =
    participants.length === 2 &&
    REVIEW_ROLES.every((role) => roles.filter((candidate) => candidate === role).length === 1);

  if (!paired) {
    throw badRequest(
      'A review needs exactly two participants: one with role "author" and one with role "reviewer".',
      'INVALID_REVIEW_ROLES',
    );
  }

  // Order carries meaning in a review: the first participant speaks first and
  // is also the arbiter that writes the verdict. Reversed, the reviewer would
  // be asked to critique an empty transcript and then judge the exchange.
  if (roles[0] !== 'author') {
    throw badRequest(
      'A review must list the "author" first: the author produces the work the reviewer critiques.',
      'INVALID_REVIEW_ROLE_ORDER',
    );
  }
}
