/**
 * The computed half of a council's outcome.
 *
 * Every assertion here is about not lying: agreement needs two voices, a risk
 * keeps the worst severity anyone gave it, confidence reflects where each
 * participant *ended*, and a run with nothing to aggregate says so instead of
 * inventing structure.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeCouncil } from '../council-summary.js';
import type { CouncilBudget } from '../collab-budget.js';
import type { CouncilContract } from '../council-contract.js';
import type { BudgetStop, CouncilTurnContract } from '../council-summary.js';

const BUDGET: CouncilBudget = { totalTokens: 100_000, maxTurns: 7, turnTimeoutMs: 300_000 };

interface Usage {
  tokensUsed: number;
  turnsUsed: number;
  stoppedBy: BudgetStop;
}

const NO_USAGE: Usage = { tokensUsed: 0, turnsUsed: 0, stoppedBy: null };

function contract(overrides: Partial<CouncilContract> = {}): CouncilContract {
  return {
    evidence: [],
    risks: [],
    tests: [],
    disagreements: [],
    confidence: null,
    ...overrides,
  };
}

function turn(profileId: string, round: number, value: Partial<CouncilContract> | null): CouncilTurnContract {
  return {
    profileId,
    round,
    contract: value === null ? null : contract(value),
    contractError: value === null ? 'no contract' : null,
  };
}

const summarize = (turns: CouncilTurnContract[], usage: Usage = NO_USAGE) =>
  summarizeCouncil({ turns, budget: BUDGET, usage });

test('an observation two participants made is an agreement; one voice is not', () => {
  const summary = summarize([
    turn('a', 1, {
      evidence: [
        { observation: 'The scheduler holds one lock.', source: 'a.ts:1' },
        { observation: 'Only A noticed this', source: null },
      ],
    }),
    turn('b', 1, {
      // Same claim, different spelling and casing: still the same point.
      evidence: [{ observation: 'the scheduler holds one lock', source: 'b.ts:2' }],
    }),
  ]);

  assert.deepEqual(summary.agreements, [
    { point: 'The scheduler holds one lock.', agreedBy: ['a', 'b'] },
  ]);
});

test('a participant repeating itself across rounds does not agree with itself', () => {
  const summary = summarize([
    turn('a', 1, { evidence: [{ observation: 'the fsync is the bottleneck', source: null }] }),
    turn('a', 2, { evidence: [{ observation: 'the fsync is the bottleneck', source: null }] }),
  ]);

  assert.deepEqual(summary.agreements, []);
});

test('disputes group by point and keep every target, most-raised first', () => {
  const summary = summarize([
    turn('a', 1, { disagreements: [{ with: 'b', point: 'the lock is not the bottleneck' }] }),
    turn('b', 1, {
      disagreements: [
        { with: 'a', point: 'The lock is not the bottleneck.' },
        { with: 'premise', point: 'this assumes a single writer' },
      ],
    }),
  ]);

  assert.deepEqual(summary.disputes, [
    { point: 'the lock is not the bottleneck', raisedBy: ['a', 'b'], against: ['b', 'a'] },
    { point: 'this assumes a single writer', raisedBy: ['b'], against: ['premise'] },
  ]);
});

test('a shared risk keeps the worst severity stated and lists everyone who raised it', () => {
  const summary = summarize([
    turn('a', 1, { risks: [{ risk: 'in-flight jobs are stranded', severity: 'low' }] }),
    turn('b', 1, {
      risks: [
        { risk: 'In-flight jobs are stranded', severity: 'high' },
        { risk: 'config drift', severity: 'medium' },
      ],
    }),
  ]);

  assert.deepEqual(summary.risks, [
    { risk: 'in-flight jobs are stranded', severity: 'high', raisedBy: ['a', 'b'] },
    { risk: 'config drift', severity: 'medium', raisedBy: ['b'] },
  ]);
});

test('confidence reflects the last round each participant spoke in', () => {
  const summary = summarize([
    turn('a', 1, { confidence: { value: 30, rationale: 'early' } }),
    turn('b', 1, { confidence: { value: 90, rationale: 'sure' } }),
    turn('a', 2, { confidence: { value: 70, rationale: 'convinced' } }),
    turn('b', 2, { confidence: { value: 80, rationale: 'still sure' } }),
  ]);

  assert.deepEqual(summary.confidence, {
    min: 70,
    median: 75,
    max: 80,
    byParticipant: [
      { profileId: 'a', value: 70 },
      { profileId: 'b', value: 80 },
    ],
  });
});

test('an odd number of participants takes the middle value, not an average', () => {
  const summary = summarize([
    turn('a', 1, { confidence: { value: 10, rationale: '' } }),
    turn('b', 1, { confidence: { value: 80, rationale: '' } }),
    turn('c', 1, { confidence: { value: 90, rationale: '' } }),
  ]);

  assert.equal(summary.confidence?.median, 80);
});

test('a run where nobody stated a confidence reports none instead of zero', () => {
  const summary = summarize([turn('a', 1, {}), turn('b', 1, null)]);

  assert.equal(summary.confidence, null);
  assert.deepEqual(summary.agreements, []);
  assert.deepEqual(summary.risks, []);
});

test('parsed and failed contracts are both counted, partials in both', () => {
  const summary = summarize([
    turn('a', 1, { confidence: { value: 50, rationale: '' } }),
    turn('b', 1, null),
    { profileId: 'c', round: 1, contract: contract(), contractError: 'missing: risks' },
  ]);

  assert.equal(summary.contractsParsed, 2);
  assert.equal(summary.contractsFailed, 2);
});

test('the budget block reports what was spent and why the loop stopped', () => {
  const summary = summarize([turn('a', 1, {})], {
    tokensUsed: 100_000,
    turnsUsed: 4,
    stoppedBy: 'tokens',
  });

  assert.deepEqual(summary.budget, {
    totalTokens: 100_000,
    maxTurns: 7,
    tokensUsed: 100_000,
    turnsUsed: 4,
    stoppedBy: 'tokens',
  });
});

test('an empty council still produces a readable summary', () => {
  const summary = summarize([]);

  assert.equal(summary.contractsParsed, 0);
  assert.equal(summary.confidence, null);
  assert.deepEqual(summary.disputes, []);
  assert.equal(summary.budget.stoppedBy, null);
});
