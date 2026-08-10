import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  __resetWorktreeContextCache,
  resolveWorktreeContext,
} from '@/modules/repo-context/services/worktree-context.service.js';
import type { GitCommandResult } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

const MAIN_PATH = normalizeProjectPath('/home/user/repo');
const WORKTREE_PATH = normalizeProjectPath('/home/user/repo-worktrees/feature-login');

type GitResponses = {
  commonDir?: string;
  toplevel?: string;
  abbrevRef?: string;
  shortHead?: string;
};

/** Fake runner mirroring the three `rev-parse` shapes the service relies on. */
function createFakeRunner(responses: GitResponses, calls: string[][] = []) {
  return async (args: string[]): Promise<GitCommandResult> => {
    calls.push(args);

    if (args.includes('--git-common-dir')) {
      if (responses.commonDir === undefined) {
        throw new Error('not a git repository');
      }
      return { stdout: `${responses.commonDir}\n`, stderr: '' };
    }
    if (args.includes('--show-toplevel')) {
      return { stdout: `${responses.toplevel ?? ''}\n`, stderr: '' };
    }
    if (args.includes('--abbrev-ref')) {
      if (responses.abbrevRef === undefined) {
        throw new Error('unborn branch');
      }
      return { stdout: `${responses.abbrevRef}\n`, stderr: '' };
    }
    if (args.includes('--short')) {
      if (responses.shortHead === undefined) {
        throw new Error('no HEAD');
      }
      return { stdout: `${responses.shortHead}\n`, stderr: '' };
    }

    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  };
}

beforeEach(() => {
  __resetWorktreeContextCache();
});

test('resolveWorktreeContext reports no worktree for the main repository root', async () => {
  const context = await resolveWorktreeContext(
    '/home/user/repo',
    createFakeRunner({ commonDir: '/home/user/repo/.git', toplevel: '/home/user/repo' }),
  );

  assert.deepEqual(context, {
    projectPath: MAIN_PATH,
    worktreePath: null,
    worktreeBranch: null,
  });
});

test('resolveWorktreeContext maps a secondary worktree to the repository root plus branch', async () => {
  const context = await resolveWorktreeContext(
    '/home/user/repo-worktrees/feature-login',
    createFakeRunner({
      commonDir: '/home/user/repo/.git',
      toplevel: '/home/user/repo-worktrees/feature-login',
      abbrevRef: 'feature/login',
    }),
  );

  assert.deepEqual(context, {
    projectPath: MAIN_PATH,
    worktreePath: WORKTREE_PATH,
    worktreeBranch: 'feature/login',
  });
});

test('resolveWorktreeContext labels a detached worktree with the short SHA', async () => {
  const context = await resolveWorktreeContext(
    '/home/user/repo-worktrees/feature-login',
    createFakeRunner({
      commonDir: '/home/user/repo/.git',
      toplevel: '/home/user/repo-worktrees/feature-login',
      abbrevRef: 'HEAD',
      shortHead: '1a2b3c4',
    }),
  );

  assert.deepEqual(context, {
    projectPath: MAIN_PATH,
    worktreePath: WORKTREE_PATH,
    worktreeBranch: '1a2b3c4',
  });
});

test('resolveWorktreeContext falls back to the directory itself outside a repository', async () => {
  const context = await resolveWorktreeContext(
    '/home/user/notes',
    createFakeRunner({ commonDir: undefined }),
  );

  assert.deepEqual(context, {
    projectPath: normalizeProjectPath('/home/user/notes'),
    worktreePath: null,
    worktreeBranch: null,
  });
});

test('resolveWorktreeContext falls back when git is unavailable, without throwing', async () => {
  const context = await resolveWorktreeContext('/home/user/repo', async () => {
    throw new Error('Failed to run git: spawn git ENOENT');
  });

  assert.deepEqual(context, {
    projectPath: MAIN_PATH,
    worktreePath: null,
    worktreeBranch: null,
  });
});

test('resolveWorktreeContext treats a bare repository common dir as non-git', async () => {
  const context = await resolveWorktreeContext(
    '/home/user/repo.git',
    createFakeRunner({ commonDir: '/home/user/repo.git', toplevel: '' }),
  );

  assert.deepEqual(context, {
    projectPath: normalizeProjectPath('/home/user/repo.git'),
    worktreePath: null,
    worktreeBranch: null,
  });
});

test('resolveWorktreeContext serves repeated lookups from cache without re-running git', async () => {
  const calls: string[][] = [];
  const runGit = createFakeRunner(
    {
      commonDir: '/home/user/repo/.git',
      toplevel: '/home/user/repo-worktrees/feature-login',
      abbrevRef: 'feature/login',
    },
    calls,
  );

  const first = await resolveWorktreeContext('/home/user/repo-worktrees/feature-login', runGit);
  const callsAfterFirst = calls.length;
  const second = await resolveWorktreeContext('/home/user/repo-worktrees/feature-login', runGit);

  assert.equal(calls.length, callsAfterFirst);
  assert.deepEqual(second, first);
});
