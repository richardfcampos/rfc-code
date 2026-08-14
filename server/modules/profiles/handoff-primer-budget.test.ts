import assert from 'node:assert/strict';
import test from 'node:test';

import { PRIMER_CHAR_BUDGET } from '@/modules/profiles/handoff-primer.js';
import { resolvePrimerBudget } from '@/modules/profiles/handoff-primer-budget.js';

test('a known model returns a budget above the floor, sourced from its window', () => {
  const budget = resolvePrimerBudget('claude', 'claude-sonnet-4');

  assert.equal(budget.source, 'known-window');
  assert.ok(budget.chars > PRIMER_CHAR_BUDGET);
});

test('a second known model, on a different provider, also derives above the floor', () => {
  const budget = resolvePrimerBudget('codex', 'gpt-4o');

  assert.equal(budget.source, 'known-window');
  assert.ok(budget.chars > PRIMER_CHAR_BUDGET);
});

test('an unknown model on a known provider falls back to exactly the floor', () => {
  const budget = resolvePrimerBudget('claude', 'some-future-model');

  assert.equal(budget.source, 'fallback');
  assert.equal(budget.chars, PRIMER_CHAR_BUDGET);
});

test('an omitted model falls back to exactly the floor', () => {
  const budget = resolvePrimerBudget('codex');

  assert.equal(budget.source, 'fallback');
  assert.equal(budget.chars, PRIMER_CHAR_BUDGET);
});

test('a provider with no entries in the table falls back to exactly the floor', () => {
  const budget = resolvePrimerBudget('cursor', 'anything');

  assert.equal(budget.source, 'fallback');
  assert.equal(budget.chars, PRIMER_CHAR_BUDGET);
});

test('the fallback budget always equals the imported PRIMER_CHAR_BUDGET floor', () => {
  const budget = resolvePrimerBudget('opencode', 'anthropic/claude-sonnet-4-5');

  assert.equal(budget.chars, PRIMER_CHAR_BUDGET);
});
