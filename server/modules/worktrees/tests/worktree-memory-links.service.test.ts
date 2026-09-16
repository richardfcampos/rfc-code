import assert from 'node:assert/strict';
import test from 'node:test';

import { linkClaudeMemoryIntoWorktree } from '@/modules/worktrees/services/worktree-memory-links.service.js';
import { claudeProjectSlug, resolveClaudeMemoryDir } from '@/modules/profiles/index.js';
import type { WorktreeFileSystem } from '@/shared/types.js';

function createFakeFileSystem(existing: string[]) {
  const present = new Set(existing);
  const symlinks: Array<{ target: string; link: string }> = [];
  const fileSystem: WorktreeFileSystem = {
    pathExists: async (candidate) => present.has(candidate),
    listDirectories: async () => [],
    ensureDirectory: async (directory) => {
      present.add(directory);
    },
    createDirectorySymlink: async (target, link) => {
      symlinks.push({ target, link });
      present.add(link);
    },
    createFileSymlink: async () => {
      throw new Error('not expected');
    },
  };
  return { fileSystem, symlinks, present };
}

test('claudeProjectSlug mirrors Claude Code project directory naming', () => {
  assert.equal(claudeProjectSlug('/srv/code/personal/rfc-code'), '-srv-code-personal-rfc-code');
  assert.equal(claudeProjectSlug('/x/.claude/wt_1'), '-x--claude-wt-1');
  assert.equal(
    resolveClaudeMemoryDir('/cfg', '/srv/code/app'),
    '/cfg/projects/-srv-code-app/memory',
  );
});

test('links the worktree memory to the root memory in every config dir', async () => {
  const { fileSystem, symlinks, present } = createFakeFileSystem([]);

  const result = await linkClaudeMemoryIntoWorktree(
    '/srv/code/app',
    '/srv/code/app-worktrees/wt-x',
    ['/home/u/.claude', '/data/profiles/claude/work'],
    fileSystem,
  );

  assert.deepEqual(symlinks, [
    {
      target: '/home/u/.claude/projects/-srv-code-app/memory',
      link: '/home/u/.claude/projects/-srv-code-app-worktrees-wt-x/memory',
    },
    {
      target: '/data/profiles/claude/work/projects/-srv-code-app/memory',
      link: '/data/profiles/claude/work/projects/-srv-code-app-worktrees-wt-x/memory',
    },
  ]);
  assert.equal(result.linked.length, 2);
  assert.ok(present.has('/home/u/.claude/projects/-srv-code-app/memory'), 'root memory dir is created');
});

test('leaves an existing worktree memory dir alone and survives a failing config dir', async () => {
  const existingMemory = '/home/u/.claude/projects/-srv-code-app-worktrees-wt-x/memory';
  const { fileSystem, symlinks } = createFakeFileSystem([existingMemory]);
  const failing: WorktreeFileSystem = {
    ...fileSystem,
    ensureDirectory: async () => {
      throw new Error('read-only');
    },
  };

  const skipped = await linkClaudeMemoryIntoWorktree(
    '/srv/code/app',
    '/srv/code/app-worktrees/wt-x',
    ['/home/u/.claude'],
    fileSystem,
  );
  const failed = await linkClaudeMemoryIntoWorktree(
    '/srv/code/app',
    '/srv/code/app-worktrees/wt-x',
    ['/data/profiles/claude/work'],
    failing,
  );

  assert.deepEqual(skipped.skipped, [existingMemory]);
  assert.equal(symlinks.length, 0);
  assert.equal(failed.failed.length, 1);
});
