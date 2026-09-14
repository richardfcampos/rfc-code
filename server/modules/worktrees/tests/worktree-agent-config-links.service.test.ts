import assert from 'node:assert/strict';
import test from 'node:test';

import { linkAgentConfigFilesIntoWorktree } from '@/modules/worktrees/services/worktree-agent-config-links.service.js';
import type { WorktreeFileSystem } from '@/shared/types.js';

const REPO = '/home/user/repo';
const WORKTREE = '/home/user/repo-worktrees/feature';

type FakeFs = WorktreeFileSystem & {
  dirSymlinks: Array<{ target: string; link: string }>;
  fileSymlinks: Array<{ target: string; link: string }>;
};

function createFakeFs(options: {
  sourceEntries: string[];
  existingPaths?: string[];
  failLink?: string;
}): FakeFs {
  const source = new Set(options.sourceEntries);
  const existing = new Set(options.existingPaths ?? []);
  const fs: FakeFs = {
    dirSymlinks: [],
    fileSymlinks: [],
    pathExists: async (candidate) => source.has(candidate) || existing.has(candidate),
    listDirectories: async () => [],
    ensureDirectory: async () => {},
    createDirectorySymlink: async (target, link) => {
      if (options.failLink && link.endsWith(options.failLink)) {
        throw new Error('EPERM');
      }
      fs.dirSymlinks.push({ target, link });
    },
    createFileSymlink: async (target, link) => {
      if (options.failLink && link.endsWith(options.failLink)) {
        throw new Error('EPERM');
      }
      fs.fileSymlinks.push({ target, link });
    },
  };
  return fs;
}

test('links CLAUDE.md, .cursor and .mcp.json when the main checkout has them', async () => {
  const fs = createFakeFs({
    sourceEntries: [`${REPO}/CLAUDE.md`, `${REPO}/.cursor`, `${REPO}/.mcp.json`],
  });

  const result = await linkAgentConfigFilesIntoWorktree(REPO, WORKTREE, fs);

  assert.deepEqual(result, { linked: ['CLAUDE.md', '.cursor', '.mcp.json'], failed: [] });
  assert.deepEqual(fs.dirSymlinks, [{ target: `${REPO}/.cursor`, link: `${WORKTREE}/.cursor` }]);
  assert.deepEqual(fs.fileSymlinks, [
    { target: `${REPO}/CLAUDE.md`, link: `${WORKTREE}/CLAUDE.md` },
    { target: `${REPO}/.mcp.json`, link: `${WORKTREE}/.mcp.json` },
  ]);
});

test('skips entries the main checkout does not have', async () => {
  const fs = createFakeFs({ sourceEntries: [`${REPO}/CLAUDE.md`] });

  const result = await linkAgentConfigFilesIntoWorktree(REPO, WORKTREE, fs);

  assert.deepEqual(result, { linked: ['CLAUDE.md'], failed: [] });
});

test('leaves an entry the worktree already has untouched', async () => {
  const fs = createFakeFs({
    sourceEntries: [`${REPO}/CLAUDE.md`, `${REPO}/.mcp.json`],
    existingPaths: [`${WORKTREE}/.mcp.json`],
  });

  const result = await linkAgentConfigFilesIntoWorktree(REPO, WORKTREE, fs);

  assert.deepEqual(result.linked, ['CLAUDE.md']);
  assert.deepEqual(fs.fileSymlinks, [{ target: `${REPO}/CLAUDE.md`, link: `${WORKTREE}/CLAUDE.md` }]);
});

test('a failed link is reported but does not abort the remaining entries', async () => {
  const fs = createFakeFs({
    sourceEntries: [`${REPO}/CLAUDE.md`, `${REPO}/.cursor`, `${REPO}/.mcp.json`],
    failLink: '.cursor',
  });

  const result = await linkAgentConfigFilesIntoWorktree(REPO, WORKTREE, fs);

  assert.deepEqual(result, { linked: ['CLAUDE.md', '.mcp.json'], failed: ['.cursor'] });
});
