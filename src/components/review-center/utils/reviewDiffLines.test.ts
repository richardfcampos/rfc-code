import assert from 'node:assert/strict';
import test from 'node:test';

import { groupCommentsByLine, parseReviewDiffLines } from './reviewDiffLines';

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -10,4 +10,5 @@ export function app() {',
  ' const before = 1;',
  '-const removed = 2;',
  '+const added = 2;',
  '+const alsoAdded = 3;',
  ' const after = 4;',
].join('\n');

test('lines before the first hunk are metadata', () => {
  const lines = parseReviewDiffLines(DIFF);

  assert.deepEqual(
    lines.slice(0, 4).map((line) => line.kind),
    ['meta', 'meta', 'meta', 'meta'],
  );
  assert.equal(lines[4].kind, 'hunk');
});

test('new-file line numbers advance across context and additions only', () => {
  const lines = parseReviewDiffLines(DIFF).slice(5);

  assert.deepEqual(
    lines.map((line) => [line.kind, line.newLineNo]),
    [
      ['context', 10],
      ['deletion', null],
      ['addition', 11],
      ['addition', 12],
      ['context', 13],
    ],
  );
});

test('old-file line numbers advance across context and deletions only', () => {
  const lines = parseReviewDiffLines(DIFF).slice(5);

  assert.deepEqual(
    lines.map((line) => line.oldLineNo),
    [10, 11, null, null, 12],
  );
});

test('a second hunk restarts both counters', () => {
  const lines = parseReviewDiffLines(
    ['@@ -1,1 +1,1 @@', ' one', '@@ -80,1 +90,1 @@', ' far away'].join('\n'),
  );

  assert.equal(lines[1].newLineNo, 1);
  assert.equal(lines[3].newLineNo, 90);
  assert.equal(lines[3].oldLineNo, 80);
});

test('the no-newline marker is metadata, not a deletion', () => {
  const lines = parseReviewDiffLines(['@@ -1,1 +1,1 @@', '-old', '\\ No newline at end of file'].join('\n'));

  assert.equal(lines[2].kind, 'meta');
});

test('a trailing blank line is dropped', () => {
  const lines = parseReviewDiffLines('@@ -1,1 +1,1 @@\n one\n');

  assert.equal(lines.length, 2);
});

test('an empty diff parses to nothing renderable', () => {
  assert.deepEqual(parseReviewDiffLines(''), []);
});

test('comments group by line and review-wide ones are skipped', () => {
  const grouped = groupCommentsByLine([
    { line_no: 12 },
    { line_no: 12 },
    { line_no: 40 },
    { line_no: null },
  ]);

  assert.equal(grouped.get(12)?.length, 2);
  assert.equal(grouped.get(40)?.length, 1);
  assert.equal(grouped.size, 2);
});
