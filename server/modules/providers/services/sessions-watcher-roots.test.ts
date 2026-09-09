import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { isWatcherTargetFile, resolveWatchRoots } from '@/modules/providers/services/sessions-watcher.service.js';

test('every provider is watched at its default home and at its profiles root', () => {
  const previous = process.env.PROFILES_ROOT;
  process.env.PROFILES_ROOT = '/srv/profiles';
  try {
    const roots = resolveWatchRoots();
    const claude = roots.filter((root) => root.provider === 'claude').map((root) => root.rootPath);
    assert.ok(claude.some((root) => root.endsWith(path.join('.claude', 'projects'))));
    assert.ok(claude.includes(path.join('/srv/profiles', 'claude')));
    assert.ok(roots.some((root) => root.provider === 'codex' && root.rootPath === path.join('/srv/profiles', 'codex')));
  } finally {
    if (previous === undefined) {
      delete process.env.PROFILES_ROOT;
    } else {
      process.env.PROFILES_ROOT = previous;
    }
  }
});

test('only transcripts inside the provider transcript directory reach the indexer', () => {
  assert.equal(isWatcherTargetFile('claude', '/p/claude/pessoal/projects/-srv-repo/abc.jsonl'), true);
  assert.equal(isWatcherTargetFile('claude', '/p/claude/pessoal/history.jsonl'), false);
  assert.equal(isWatcherTargetFile('claude', '/p/claude/pessoal/projects/-srv-repo/notes.txt'), false);
  assert.equal(isWatcherTargetFile('codex', '/p/codex/work/sessions/2026/09/09/rollout.jsonl'), true);
  assert.equal(isWatcherTargetFile('opencode', '/p/opencode/work/data/opencode/opencode.db'), true);
  assert.equal(isWatcherTargetFile('opencode', '/home/u/.local/share/opencode/opencode.db'), true);
  assert.equal(isWatcherTargetFile('opencode', '/p/opencode/work/data/opencode/other.db'), false);
});
