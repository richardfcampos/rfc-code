import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCompareFiles } from './git-compare.js';

// NUL-separated output with a trailing NUL, exactly as `git ... -z` emits it.
const z = (...entries) => (entries.length ? entries.join('\0') + '\0' : '');

test('parseCompareFiles joins name-status, numstat and untracked files', () => {
  const nameStatus = z('M', 'src/app.ts', 'A', 'src/new.ts', 'D', 'old.ts');
  const numStat = z('3\t1\tsrc/app.ts', '10\t0\tsrc/new.ts', '0\t7\told.ts');
  const untracked = z('notes.md');

  assert.deepEqual(parseCompareFiles(nameStatus, numStat, untracked), [
    { path: 'src/app.ts', previousPath: null, status: 'M', insertions: 3, deletions: 1 },
    { path: 'src/new.ts', previousPath: null, status: 'A', insertions: 10, deletions: 0 },
    { path: 'old.ts', previousPath: null, status: 'D', insertions: 0, deletions: 7 },
    { path: 'notes.md', previousPath: null, status: 'U', insertions: 0, deletions: 0 },
  ]);
});

test('parseCompareFiles pairs rename entries and keeps the new path', () => {
  const nameStatus = z('R090', 'src/before.ts', 'src/after.ts', 'M', 'other.ts');
  // Renames in numstat -z: an empty path, then the old/new pair as entries.
  const numStat = z('2\t2\t', 'src/before.ts', 'src/after.ts', '1\t0\tother.ts');

  assert.deepEqual(parseCompareFiles(nameStatus, numStat, ''), [
    { path: 'src/after.ts', previousPath: 'src/before.ts', status: 'M', insertions: 2, deletions: 2 },
    { path: 'other.ts', previousPath: null, status: 'M', insertions: 1, deletions: 0 },
  ]);
});

test('parseCompareFiles zeroes binary counts and keeps paths with spaces', () => {
  const nameStatus = z('M', 'assets/my logo.png');
  const numStat = z('-\t-\tassets/my logo.png');

  assert.deepEqual(parseCompareFiles(nameStatus, numStat, ''), [
    { path: 'assets/my logo.png', previousPath: null, status: 'M', insertions: 0, deletions: 0 },
  ]);
});

test('parseCompareFiles handles empty output', () => {
  assert.deepEqual(parseCompareFiles('', '', ''), []);
});
