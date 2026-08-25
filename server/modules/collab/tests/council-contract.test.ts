/**
 * What a council turn is allowed to look like.
 *
 * Every case here is something a model actually does: fencing the object,
 * quoting the template before answering it, sending a single entry unwrapped,
 * inventing a severity, or forgetting half the contract. None of them may throw,
 * and none of them may cost the raw answer.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJsonObject } from '../council-json-block.js';
import { PREMISE_TARGET, parseCouncilContract } from '../council-contract.js';

const WELL_FORMED = `The scheduler split is worth doing, but not this sprint.

\`\`\`json
{
  "evidence": [
    { "observation": "runScheduler holds the lock across the whole batch", "source": "server/scheduler.ts:142" },
    { "observation": "no test covers the retry path" }
  ],
  "risks": [
    { "risk": "splitting mid-release strands in-flight jobs", "severity": "high" },
    { "risk": "two config surfaces to keep in sync", "severity": "low" }
  ],
  "tests": [
    { "test": "run the batch suite against a 10k queue", "status": "executed", "result": "passes in 4s" },
    { "test": "kill the worker mid-batch and assert no double-run", "status": "proposed" }
  ],
  "disagreements": [
    { "with": "Personal", "point": "the lock is not the bottleneck; the fsync is" }
  ],
  "confidence": { "value": 72, "rationale": "read the scheduler, did not profile it" }
}
\`\`\``;

test('a well-formed contract parses every field with no error', () => {
  const { contract, error } = parseCouncilContract(WELL_FORMED);

  assert.equal(error, null);
  assert.ok(contract);
  assert.deepEqual(contract.evidence, [
    {
      observation: 'runScheduler holds the lock across the whole batch',
      source: 'server/scheduler.ts:142',
    },
    { observation: 'no test covers the retry path', source: null },
  ]);
  assert.deepEqual(contract.risks, [
    { risk: 'splitting mid-release strands in-flight jobs', severity: 'high' },
    { risk: 'two config surfaces to keep in sync', severity: 'low' },
  ]);
  assert.deepEqual(contract.tests, [
    { test: 'run the batch suite against a 10k queue', status: 'executed', result: 'passes in 4s' },
    { test: 'kill the worker mid-batch and assert no double-run', status: 'proposed', result: null },
  ]);
  assert.deepEqual(contract.disagreements, [
    { with: 'Personal', point: 'the lock is not the bottleneck; the fsync is' },
  ]);
  assert.deepEqual(contract.confidence, {
    value: 72,
    rationale: 'read the scheduler, did not profile it',
  });
});

test('the last object wins, so a quoted template cannot outrank the real answer', () => {
  const content = `I was asked to answer in this shape:

\`\`\`json
{ "evidence": [], "risks": [], "tests": [], "disagreements": [], "confidence": { "value": 0, "rationale": "template" } }
\`\`\`

Here is my actual answer:

\`\`\`json
{ "evidence": ["the index is missing"], "risks": [], "tests": [], "disagreements": [], "confidence": { "value": 90, "rationale": "measured" } }
\`\`\``;

  const { contract, error } = parseCouncilContract(content);

  assert.equal(error, null);
  assert.equal(contract?.confidence?.value, 90);
  assert.deepEqual(contract?.evidence, [{ observation: 'the index is missing', source: null }]);
});

test('an answer with no JSON at all keeps its prose and reports the miss', () => {
  const { contract, error } = parseCouncilContract('I think we should keep SQLite.\nCONSENSUS: NO — costs');

  assert.equal(contract, null);
  assert.match(error ?? '', /no council contract json object/i);
});

test('a truncated JSON block is a miss, not a crash', () => {
  const { contract, error } = parseCouncilContract('```json\n{ "evidence": [{ "observation": "half a\n```');

  assert.equal(contract, null);
  assert.ok(error);
});

test('a partial contract keeps what parsed and names what is missing', () => {
  const { contract, error } = parseCouncilContract(
    '{ "evidence": [{ "observation": "the queue drains" }], "confidence": 55 }',
  );

  assert.ok(contract);
  assert.equal(contract.evidence.length, 1);
  assert.deepEqual(contract.risks, []);
  assert.deepEqual(contract.confidence, { value: 55, rationale: '' });
  assert.match(error ?? '', /missing: risks, tests, disagreements/);
});

test('a contract with no confidence is partial rather than confident at zero', () => {
  const { contract, error } = parseCouncilContract(
    '{ "evidence": [], "risks": [], "tests": [], "disagreements": [] }',
  );

  assert.equal(contract?.confidence, null);
  assert.match(error ?? '', /missing: confidence/);
});

test('unwrapped entries, unknown severities and missing targets are normalized', () => {
  const { contract } = parseCouncilContract(`{
    "evidence": "the migration is idempotent",
    "risk": { "risk": "unbounded retry", "severity": "catastrophic" },
    "test": "replay the migration twice",
    "disagreement": { "point": "the premise assumes one writer" },
    "confidence": { "value": 120, "rationale": "  sure  " }
  }`);

  assert.deepEqual(contract?.evidence, [
    { observation: 'the migration is idempotent', source: null },
  ]);
  assert.deepEqual(contract?.risks, [{ risk: 'unbounded retry', severity: 'medium' }]);
  assert.deepEqual(contract?.tests, [
    { test: 'replay the migration twice', status: 'proposed', result: null },
  ]);
  assert.deepEqual(contract?.disagreements, [
    { with: PREMISE_TARGET, point: 'the premise assumes one writer' },
  ]);
  // Out of range is clamped: 120 still means "as sure as it gets".
  assert.deepEqual(contract?.confidence, { value: 100, rationale: 'sure' });
});

test('entries that carry no text are dropped instead of stored empty', () => {
  const { contract } = parseCouncilContract(`{
    "evidence": [{ "source": "file.ts:1" }, "  ", 42, { "observation": "kept" }],
    "risks": [], "tests": [], "disagreements": [], "confidence": { "value": 10, "rationale": "x" }
  }`);

  assert.deepEqual(contract?.evidence, [{ observation: 'kept', source: null }]);
});

test('a bare object with prose around it is still found', () => {
  const parsed = extractJsonObject(
    'Reasoning first. { "confidence": { "value": 40, "rationale": "why { and } appear here" } } Done.',
  );

  assert.deepEqual(parsed, { confidence: { value: 40, rationale: 'why { and } appear here' } });
});

test('an empty or non-string answer never throws', () => {
  assert.equal(extractJsonObject(''), null);
  assert.equal(extractJsonObject(undefined as unknown as string), null);
  assert.equal(parseCouncilContract('').contract, null);
});
