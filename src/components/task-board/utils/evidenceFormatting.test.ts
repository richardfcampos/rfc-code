import assert from 'node:assert/strict';
import test from 'node:test';

import { evidenceKindLabel, isHttpUrl, TASK_EVIDENCE_KINDS } from './evidenceFormatting';

test('evidenceKindLabel has a label for every evidence kind', () => {
  for (const kind of TASK_EVIDENCE_KINDS) {
    assert.equal(typeof evidenceKindLabel(kind), 'string');
    assert.ok(evidenceKindLabel(kind).length > 0);
  }
});

test('isHttpUrl accepts http(s) URLs, including with surrounding whitespace', () => {
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('http://example.com/path?x=1'), true);
  assert.equal(isHttpUrl('  https://example.com  '), true);
});

test('isHttpUrl rejects file paths and other schemes', () => {
  assert.equal(isHttpUrl('/srv/code/foo.ts'), false);
  assert.equal(isHttpUrl('ftp://example.com'), false);
  assert.equal(isHttpUrl('relative/path.md'), false);
  assert.equal(isHttpUrl(''), false);
});
