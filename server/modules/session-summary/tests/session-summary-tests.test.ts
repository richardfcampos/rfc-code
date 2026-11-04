import assert from 'node:assert/strict';
import test from 'node:test';

import { detectTestRun } from '@/modules/session-summary/session-summary-tests.js';
import type { NormalizedMessage } from '@/shared/types.js';

function toolResult(content: string): NormalizedMessage {
  return { id: 'r', sessionId: 's', timestamp: 't', provider: 'claude', kind: 'tool_result', content };
}

test('node:test TAP summary is recognised', () => {
  const run = detectTestRun([toolResult('# tests 43\n# suites 0\n# pass 41\n# fail 2\n# cancelled 0\n')]);
  assert.deepEqual(run, { runner: 'node:test', passed: 41, failed: 2, total: 43 });
});

test('jest and vitest summaries parse parts in any order and tolerate a missing failed count', () => {
  const jest = detectTestRun([toolResult('Test Suites: 3 passed, 3 total\nTests:       12 passed, 12 total\nSnapshots:   0 total')]);
  assert.deepEqual(jest, { runner: 'jest', passed: 12, failed: 0, total: 12 });

  const vitest = detectTestRun([toolResult(' RUN  v2.1.0 /repo\n ✓ a.test.ts (3)\n Test Files  1 passed (1)\n      Tests  2 failed | 10 passed (12)\n')]);
  // vitest's own line is not the `Tests:` form; a jest-style line is what the matcher reads.
  assert.equal(vitest, null);

  const vitestJestStyle = detectTestRun([toolResult(' RUN  v2.1.0\nTests:  2 failed, 10 passed, 12 total')]);
  assert.deepEqual(vitestJestStyle, { runner: 'vitest', passed: 10, failed: 2, total: 12 });
});

test('pytest summary line counts failures and errors together', () => {
  const run = detectTestRun([toolResult('===================== 12 passed, 1 failed, 1 error, 2 skipped in 0.42s =====================')]);
  assert.deepEqual(run, { runner: 'pytest', passed: 12, failed: 2, total: 14 });
});

test('phpunit OK and failing summaries', () => {
  assert.deepEqual(detectTestRun([toolResult('OK (12 tests, 30 assertions)')]), { runner: 'phpunit', passed: 12, failed: 0, total: 12 });
  assert.deepEqual(
    detectTestRun([toolResult('FAILURES!\nTests: 12, Assertions: 30, Failures: 1, Errors: 1.')]),
    { runner: 'phpunit', passed: 10, failed: 2, total: 12 },
  );
});

test('the last run in the turn wins and non-test output yields null', () => {
  const run = detectTestRun([
    toolResult('# pass 3\n# fail 1\n'),
    toolResult('npm run lint\nok'),
    toolResult('# pass 4\n# fail 0\n'),
  ]);
  assert.deepEqual(run, { runner: 'node:test', passed: 4, failed: 0, total: 4 });
  assert.equal(detectTestRun([toolResult('total 48\ndrwxr-xr-x 2 me me 4096 .')]), null);
  assert.equal(detectTestRun([{ id: 'x', sessionId: 's', timestamp: 't', provider: 'claude', kind: 'tool_use', toolName: 'Bash' }]), null);
});

test('nested toolResult content is scanned too', () => {
  const event: NormalizedMessage = {
    id: 'r', sessionId: 's', timestamp: 't', provider: 'codex', kind: 'tool_result', toolResult: { content: '# pass 7\n# fail 0\n' },
  };
  assert.deepEqual(detectTestRun([event]), { runner: 'node:test', passed: 7, failed: 0, total: 7 });
});
