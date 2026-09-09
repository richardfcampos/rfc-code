import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWorktreeLabel, getSessionWorktreeLabel } from './utils';

test('app-made worktree branches keep a single wt/ prefix', () => {
  assert.equal(formatWorktreeLabel('wt/veja-os-comentarios'), 'wt/veja-os-comentarios');
  assert.equal(formatWorktreeLabel('main'), 'wt/main');
});

test('the label prefers the branch and falls back to the path basename', () => {
  assert.equal(
    getSessionWorktreeLabel({ id: 's', worktreePath: '/repo-worktrees/wt-x', worktreeBranch: 'wt/x' }),
    'wt/x',
  );
  assert.equal(getSessionWorktreeLabel({ id: 's', worktreePath: '/repo-worktrees/wt-x' }), 'wt-x');
  assert.equal(getSessionWorktreeLabel({ id: 's' }), null);
});
