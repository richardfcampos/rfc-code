/**
 * Budget validation, defaults and the read path for rows that predate budgets.
 *
 * The property that matters most is the boring one: a request that sends no
 * budget, and a row that stores none, must both land on the ceiling the run
 * already had — otherwise turning budgets on would shorten runs nobody asked to
 * shorten.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_TOTAL_TOKENS,
  DEFAULT_TURN_TIMEOUT_MS,
  defaultCouncilBudget,
  perTurnTokenAllowance,
  readCouncilBudget,
  resolveStoredBudget,
} from '../collab-budget.js';

const SHAPE = { seats: 2, rounds: 3 };

test('the default budget mirrors the run the caller already described', () => {
  assert.deepEqual(defaultCouncilBudget(SHAPE), {
    totalTokens: DEFAULT_TOTAL_TOKENS,
    // Two seats over three rounds, plus the synthesis.
    maxTurns: 7,
    turnTimeoutMs: DEFAULT_TURN_TIMEOUT_MS,
  });
  assert.deepEqual(readCouncilBudget(undefined, SHAPE), defaultCouncilBudget(SHAPE));
  assert.deepEqual(readCouncilBudget(null, SHAPE), defaultCouncilBudget(SHAPE));
});

test('each field is independent: one override never resets the others', () => {
  const budget = readCouncilBudget({ totalTokens: 50_000 }, SHAPE);

  assert.equal(budget.totalTokens, 50_000);
  assert.equal(budget.maxTurns, 7);
  assert.equal(budget.turnTimeoutMs, DEFAULT_TURN_TIMEOUT_MS);
});

test('out-of-range and non-numeric fields are refused with a named error', () => {
  const cases: [unknown, RegExp][] = [
    [{ totalTokens: 10 }, /totalTokens/],
    [{ totalTokens: 9_000_000 }, /totalTokens/],
    [{ totalTokens: 1000.5 }, /totalTokens/],
    [{ totalTokens: '50000' }, /totalTokens/],
    [{ maxTurns: 0 }, /maxTurns/],
    [{ maxTurns: 65 }, /maxTurns/],
    [{ turnTimeoutMs: 500 }, /turnTimeoutMs/],
    [{ turnTimeoutMs: 3_600_000 }, /turnTimeoutMs/],
  ];

  for (const [value, message] of cases) {
    assert.throws(
      () => readCouncilBudget(value, SHAPE),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, 'INVALID_BUDGET');
        assert.match(error.message, message);
        return true;
      },
      `expected ${JSON.stringify(value)} to be refused`,
    );
  }
});

test('a budget that is not an object at all is refused', () => {
  assert.throws(() => readCouncilBudget([], SHAPE), /budget must be an object/);
  assert.throws(() => readCouncilBudget('generous', SHAPE), /budget must be an object/);
});

test('a row with no budget reads back as the defaults for its shape', () => {
  assert.deepEqual(resolveStoredBudget(null, SHAPE), defaultCouncilBudget(SHAPE));
  assert.deepEqual(resolveStoredBudget('', SHAPE), defaultCouncilBudget(SHAPE));
});

test('a corrupted or partial stored budget degrades field by field, never throws', () => {
  assert.deepEqual(resolveStoredBudget('not json', SHAPE), defaultCouncilBudget(SHAPE));
  assert.deepEqual(resolveStoredBudget('[1,2]', SHAPE), defaultCouncilBudget(SHAPE));
  assert.deepEqual(resolveStoredBudget('{"maxTurns": 3}', SHAPE), {
    totalTokens: DEFAULT_TOTAL_TOKENS,
    maxTurns: 3,
    turnTimeoutMs: DEFAULT_TURN_TIMEOUT_MS,
  });
  assert.deepEqual(resolveStoredBudget('{"maxTurns": -4, "totalTokens": "x"}', SHAPE), {
    totalTokens: DEFAULT_TOTAL_TOKENS,
    maxTurns: 7,
    turnTimeoutMs: DEFAULT_TURN_TIMEOUT_MS,
  });
});

test('the per-turn allowance divides the ceiling between the turns that will run', () => {
  assert.equal(perTurnTokenAllowance({ totalTokens: 70_000, maxTurns: 7, turnTimeoutMs: 1 }), 10_000);
  // Never zero: a turn told it may spend nothing has nothing to say.
  assert.equal(perTurnTokenAllowance({ totalTokens: 1_000, maxTurns: 64, turnTimeoutMs: 1 }), 15);
});
