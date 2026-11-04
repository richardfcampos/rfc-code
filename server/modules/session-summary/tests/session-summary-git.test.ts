import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectGitSummary } from '@/modules/session-summary/session-summary-git.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
  });
}

async function withRepo(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'session-summary-git-'));
  try {
    git(cwd, 'init', '-q', '-b', 'main');
    git(cwd, 'config', 'commit.gpgsign', 'false');
    await writeFile(path.join(cwd, 'a.txt'), 'one\n');
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-q', '-m', 'feat: first commit');
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('collectGitSummary reports branch, diff stat, changed files, untracked count and last commit', async () => {
  await withRepo(async (cwd) => {
    await writeFile(path.join(cwd, 'a.txt'), 'one\ntwo\n');
    await writeFile(path.join(cwd, 'new.txt'), 'x\n');

    const summary = await collectGitSummary(cwd);
    assert.ok(summary);
    assert.equal(summary.branch, 'main');
    assert.match(summary.diffStat ?? '', /1 file changed, 1 insertion\(\+\)/);
    assert.deepEqual(summary.files, ['a.txt']);
    assert.equal(summary.filesTruncated, false);
    assert.equal(summary.untracked, 1);
    assert.equal(summary.lastCommit?.message, 'feat: first commit');
    assert.match(summary.lastCommit?.hash ?? '', /^[0-9a-f]{7,}$/);
  });
});

test('a clean tree has no diff stat and no files', async () => {
  await withRepo(async (cwd) => {
    const summary = await collectGitSummary(cwd);
    assert.ok(summary);
    assert.equal(summary.diffStat, null);
    assert.deepEqual(summary.files, []);
    assert.equal(summary.untracked, 0);
  });
});

test('outside a repository (or with no cwd) the block is null instead of an error', async () => {
  const plain = await mkdtemp(path.join(tmpdir(), 'session-summary-plain-'));
  try {
    assert.equal(await collectGitSummary(plain), null);
  } finally {
    await rm(plain, { recursive: true, force: true });
  }
  assert.equal(await collectGitSummary(null), null);
  assert.equal(await collectGitSummary('/definitely/missing/dir'), null);
});

test('a runner that fails mid-way degrades the sub-facts, not the whole block', async () => {
  const runner = async (args: string[]): Promise<string> => {
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true\n';
    if (args[0] === 'rev-parse') return 'feat/x\n';
    throw new Error('boom');
  };
  const summary = await collectGitSummary('/any', runner);
  assert.deepEqual(summary, { branch: 'feat/x', diffStat: null, files: [], filesTruncated: false, untracked: 0, lastCommit: null });
});
