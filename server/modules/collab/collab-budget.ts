/**
 * The spending ceiling of one collaboration, and the one rule that makes it a
 * ceiling rather than a wish.
 *
 * A council is the most expensive thing this application starts on the user's
 * behalf: every round bills every participating account, and the interesting
 * failure is not a crash but a run that quietly costs ten times what the person
 * who started it expected. The budget is therefore three numbers, enforced in
 * two places — the prompt tells each participant what it may spend, and the
 * round loop stops opening turns once the run has spent it. Instruction alone
 * would be a suggestion; the cap alone would surprise a model mid-thought.
 *
 * Defaults are derived from the run the caller already described, so a request
 * that sends no budget behaves exactly like every collaboration did before
 * budgets existed. That is the whole backward-compatibility story: the ceiling
 * lands on the ceiling the run already had.
 */

import { badRequest } from './collab-input-errors.js';

export interface CouncilBudget {
  /**
   * Token ceiling for the whole run, counted across every participant, from the
   * usage the provider adapters report. Providers that report nothing can never
   * trip it — the turn cap is what bounds those runs.
   */
  totalTokens: number;
  /** Ceiling on turns for the whole run, arbiter included. */
  maxTurns: number;
  /** Per-turn wall-clock deadline. */
  turnTimeoutMs: number;
}

/** The shape of a run, which is what the defaults are computed from. */
export interface BudgetRunShape {
  seats: number;
  rounds: number;
}

/** Five minutes: long enough for a reasoning turn, short enough to not hang a run. */
export const DEFAULT_TURN_TIMEOUT_MS = 300_000;

/**
 * Generous on purpose: at the default shape (two seats, three rounds, one
 * arbiter) it leaves roughly 28k tokens per turn, which no honest answer
 * reaches. It exists to stop a runaway, not to shorten an argument.
 */
export const DEFAULT_TOTAL_TOKENS = 200_000;

const MIN_TOTAL_TOKENS = 1_000;
const MAX_TOTAL_TOKENS = 5_000_000;
const MIN_TURNS = 1;
const MAX_TURNS = 64;
const MIN_TURN_TIMEOUT_MS = 10_000;
const MAX_TURN_TIMEOUT_MS = 1_800_000;

/** Every run ends with one synthesis turn, which is billed like any other. */
export const defaultMaxTurns = (shape: BudgetRunShape): number =>
  Math.min(MAX_TURNS, Math.max(MIN_TURNS, shape.seats * shape.rounds + 1));

export function defaultCouncilBudget(shape: BudgetRunShape): CouncilBudget {
  return {
    totalTokens: DEFAULT_TOTAL_TOKENS,
    maxTurns: defaultMaxTurns(shape),
    turnTimeoutMs: DEFAULT_TURN_TIMEOUT_MS,
  };
}

function readBounded(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;

  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isInteger(number) || number < min || number > max) {
    throw badRequest(
      `budget.${name} must be a whole number between ${min} and ${max}.`,
      'INVALID_BUDGET',
    );
  }
  return number;
}

/**
 * Validates a budget sent with a create request. Absent means "the defaults for
 * this run", and each field is independent: raising the token ceiling without
 * mentioning turns must not silently reset the turn cap.
 */
export function readCouncilBudget(value: unknown, shape: BudgetRunShape): CouncilBudget {
  const defaults = defaultCouncilBudget(shape);
  if (value === undefined || value === null) return defaults;

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('budget must be an object.', 'INVALID_BUDGET');
  }

  const source = value as Record<string, unknown>;
  return {
    totalTokens: readBounded(
      source.totalTokens, 'totalTokens', MIN_TOTAL_TOKENS, MAX_TOTAL_TOKENS, defaults.totalTokens,
    ),
    maxTurns: readBounded(source.maxTurns, 'maxTurns', MIN_TURNS, MAX_TURNS, defaults.maxTurns),
    turnTimeoutMs: readBounded(
      source.turnTimeoutMs, 'turnTimeoutMs', MIN_TURN_TIMEOUT_MS, MAX_TURN_TIMEOUT_MS,
      defaults.turnTimeoutMs,
    ),
  };
}

/**
 * Reads a budget back off a stored row. Nothing here throws: a row written by
 * an older build carries no budget at all, and a hand-edited one must still be
 * runnable. Anything unreadable falls back to the defaults for the run shape,
 * which is the behaviour that build had.
 */
export function resolveStoredBudget(raw: string | null, shape: BudgetRunShape): CouncilBudget {
  const defaults = defaultCouncilBudget(shape);
  if (!raw) return defaults;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults;
    const source = parsed as Record<string, unknown>;
    const read = (key: keyof CouncilBudget): number =>
      typeof source[key] === 'number' && Number.isFinite(source[key]) && (source[key] as number) > 0
        ? Math.floor(source[key] as number)
        : defaults[key];

    return {
      totalTokens: read('totalTokens'),
      maxTurns: read('maxTurns'),
      turnTimeoutMs: read('turnTimeoutMs'),
    };
  } catch {
    return defaults;
  }
}

/** What one turn is told it may spend, so the ceiling is shared, not raced for. */
export const perTurnTokenAllowance = (budget: CouncilBudget): number =>
  Math.max(1, Math.floor(budget.totalTokens / Math.max(1, budget.maxTurns)));
