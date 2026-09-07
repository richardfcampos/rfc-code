import assert from 'node:assert/strict';
import test from 'node:test';

import { linkProjectSkillsIntoWorktree } from '@/modules/worktrees/services/worktree-skill-links.service.js';
import type { WorktreeFileSystem } from '@/shared/types.js';

const REPO = '/home/user/repo';
const WORKTREE = '/home/user/repo-worktrees/feature';
const SOURCE_SKILLS = `${REPO}/.claude/skills`;
const TARGET_SKILLS = `${WORKTREE}/.claude/skills`;

type FakeFs = WorktreeFileSystem & {
  symlinks: Array<{ target: string; link: string }>;
  ensuredDirs: string[];
};

function createFakeFs(options: {
  sourceSkills: string[];
  existingPaths?: string[];
  failLink?: string;
}): FakeFs {
  const existing = new Set(options.existingPaths ?? []);
  const fs: FakeFs = {
    symlinks: [],
    ensuredDirs: [],
    pathExists: async (candidate) => existing.has(candidate),
    listDirectories: async (dir) => (dir === SOURCE_SKILLS ? options.sourceSkills : []),
    ensureDirectory: async (dir) => {
      fs.ensuredDirs.push(dir);
    },
    createDirectorySymlink: async (target, link) => {
      if (options.failLink && link.endsWith(options.failLink)) {
        throw new Error('EPERM');
      }
      fs.symlinks.push({ target, link });
    },
  };
  return fs;
}

test('links every skill of the main checkout that the worktree lacks', async () => {
  const fs = createFakeFs({ sourceSkills: ['add-league', 'map-league'] });

  const result = await linkProjectSkillsIntoWorktree(REPO, WORKTREE, fs);

  assert.deepEqual(result, { linked: ['add-league', 'map-league'], failed: [] });
  assert.deepEqual(fs.ensuredDirs, [TARGET_SKILLS]);
  assert.deepEqual(fs.symlinks, [
    { target: `${SOURCE_SKILLS}/add-league`, link: `${TARGET_SKILLS}/add-league` },
    { target: `${SOURCE_SKILLS}/map-league`, link: `${TARGET_SKILLS}/map-league` },
  ]);
});

test('leaves skills the worktree already has (tracked) untouched', async () => {
  const fs = createFakeFs({
    sourceSkills: ['tracked-skill', 'map-league'],
    existingPaths: [`${TARGET_SKILLS}/tracked-skill`],
  });

  const result = await linkProjectSkillsIntoWorktree(REPO, WORKTREE, fs);

  assert.deepEqual(result.linked, ['map-league']);
  assert.equal(fs.symlinks.length, 1);
  assert.equal(fs.symlinks[0].link, `${TARGET_SKILLS}/map-league`);
});

test('does nothing when the main checkout has no project skills', async () => {
  const fs = createFakeFs({ sourceSkills: [] });

  const result = await linkProjectSkillsIntoWorktree(REPO, WORKTREE, fs);

  assert.deepEqual(result, { linked: [], failed: [] });
  assert.deepEqual(fs.ensuredDirs, []);
  assert.deepEqual(fs.symlinks, []);
});

test('a failed link is reported but does not abort the remaining skills', async () => {
  const fs = createFakeFs({ sourceSkills: ['broken', 'map-league'], failLink: '/broken' });

  const result = await linkProjectSkillsIntoWorktree(REPO, WORKTREE, fs);

  assert.deepEqual(result, { linked: ['map-league'], failed: ['broken'] });
});
