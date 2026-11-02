import assert from 'node:assert/strict';
import test from 'node:test';

import { gitTools } from '@/modules/grokbot-mcp/tools/git.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';
import { worktreeTools } from '@/modules/grokbot-mcp/tools/worktrees.tools.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

const P = { projectId: 'p1' };

test('worktree_list queries by project', async () => {
  const { request } = await runToolAndCapture(worktreeTools, 'worktree_list', P);
  assert.equal(request?.method, 'GET');
  assert.equal(request?.path, '/api/worktrees');
  assert.deepEqual(request?.query, { project: 'p1' });
});

test('worktree_create sends project and only the given options', async () => {
  const minimal = await runToolAndCapture(worktreeTools, 'worktree_create', { ...P, branch: 'feat/x' });
  assert.equal(minimal.request?.method, 'POST');
  assert.equal(minimal.request?.path, '/api/worktrees/create');
  assert.deepEqual(minimal.request?.body, { project: 'p1', branch: 'feat/x' });
  const full = await runToolAndCapture(worktreeTools, 'worktree_create', { ...P, branch: 'b', baseBranch: 'main', uniqueBranch: true });
  assert.deepEqual(full.request?.body, { project: 'p1', branch: 'b', baseBranch: 'main', uniqueBranch: true });
});

test('worktree_open, merge and remove post to their routes', async () => {
  const open = await runToolAndCapture(worktreeTools, 'worktree_open', { ...P, worktreePath: '/w' });
  assert.equal(open.request?.path, '/api/worktrees/open');
  assert.deepEqual(open.request?.body, { project: 'p1', worktreePath: '/w' });

  const merge = await runToolAndCapture(worktreeTools, 'worktree_merge', {
    ...P, worktreePath: '/w', squash: true, message: 'm', removeAfterMerge: false,
  });
  assert.equal(merge.request?.method, 'POST');
  assert.equal(merge.request?.path, '/api/worktrees/merge');
  assert.deepEqual(merge.request?.body, { project: 'p1', worktreePath: '/w', squash: true, message: 'm', removeAfterMerge: false });

  const remove = await runToolAndCapture(worktreeTools, 'worktree_remove', { ...P, worktreePath: '/w', force: true, deleteBranch: true });
  assert.equal(remove.request?.path, '/api/worktrees/remove');
  assert.deepEqual(remove.request?.body, { project: 'p1', worktreePath: '/w', force: true, deleteBranch: true });
});

test('worktree tools reject missing required arguments', async () => {
  await assert.rejects(runToolAndCapture(worktreeTools, 'worktree_list', {}), ToolInputError);
  await assert.rejects(runToolAndCapture(worktreeTools, 'worktree_create', P), ToolInputError);
  await assert.rejects(runToolAndCapture(worktreeTools, 'worktree_open', P), ToolInputError);
  await assert.rejects(runToolAndCapture(worktreeTools, 'worktree_merge', P), ToolInputError);
  await assert.rejects(runToolAndCapture(worktreeTools, 'worktree_remove', { ...P, worktreePath: ' ' }), ToolInputError);
});

const readCases: Array<[string, Record<string, unknown>, string, Record<string, string | number>]> = [
  ['git_status', {}, '/api/git/status', {}],
  ['git_diff', { file: 'a.ts' }, '/api/git/diff', { file: 'a.ts' }],
  ['git_file_with_diff', { file: 'a.ts' }, '/api/git/file-with-diff', { file: 'a.ts' }],
  ['git_branches', {}, '/api/git/branches', {}],
  ['git_commits', {}, '/api/git/commits', {}],
  ['git_commits', { limit: 5 }, '/api/git/commits', { limit: 5 }],
  ['git_commit_diff', { commit: 'abc' }, '/api/git/commit-diff', { commit: 'abc' }],
  ['git_remote_status', {}, '/api/git/remote-status', {}],
  ['git_compare', { base: 'main' }, '/api/git/compare', { base: 'main' }],
  ['git_compare_diff', { base: 'main', file: 'a.ts' }, '/api/git/compare-diff', { base: 'main', file: 'a.ts' }],
];

for (const [name, args, path, extra] of readCases) {
  test(`${name} GETs ${path} with project in the query`, async () => {
    const { request } = await runToolAndCapture(gitTools, name, { ...P, ...args });
    assert.equal(request?.method, 'GET');
    assert.equal(request?.path, path);
    assert.deepEqual(request?.query, { project: 'p1', ...extra });
    assert.equal(request?.body, undefined);
  });
}

const writeCases: Array<[string, Record<string, unknown>, string, Record<string, unknown>]> = [
  ['git_stage', { files: ['a', 'b'] }, '/api/git/stage', { files: ['a', 'b'] }],
  ['git_unstage', { files: ['a'] }, '/api/git/unstage', { files: ['a'] }],
  ['git_discard', { file: 'a' }, '/api/git/discard', { file: 'a' }],
  ['git_delete_untracked', { file: 'a' }, '/api/git/delete-untracked', { file: 'a' }],
  ['git_commit', { message: 'msg', files: ['a'] }, '/api/git/commit', { message: 'msg', files: ['a'] }],
  ['git_generate_commit_message', { files: ['a'] }, '/api/git/generate-commit-message', { files: ['a'] }],
  ['git_generate_commit_message', { files: ['a'], provider: 'cursor' }, '/api/git/generate-commit-message', { files: ['a'], provider: 'cursor' }],
  ['git_initial_commit', {}, '/api/git/initial-commit', {}],
  ['git_revert_local_commit', {}, '/api/git/revert-local-commit', {}],
  ['git_checkout', { branch: 'dev' }, '/api/git/checkout', { branch: 'dev' }],
  ['git_create_branch', { branch: 'dev' }, '/api/git/create-branch', { branch: 'dev' }],
  ['git_delete_branch', { branch: 'dev' }, '/api/git/delete-branch', { branch: 'dev' }],
  ['git_fetch', {}, '/api/git/fetch', {}],
  ['git_pull', {}, '/api/git/pull', {}],
  ['git_push', {}, '/api/git/push', {}],
  ['git_publish', { branch: 'dev' }, '/api/git/publish', { branch: 'dev' }],
];

for (const [name, args, path, extra] of writeCases) {
  test(`${name} POSTs ${path} with project in the body`, async () => {
    const { request } = await runToolAndCapture(gitTools, name, { ...P, ...args });
    assert.equal(request?.method, 'POST');
    assert.equal(request?.path, path);
    assert.deepEqual(request?.body, { project: 'p1', ...extra });
    assert.equal(request?.query, undefined);
  });
}

test('git tool set has all 24 tools and every one requires projectId', async () => {
  assert.equal(gitTools.length, 24);
  for (const definition of gitTools) {
    assert.ok(definition.inputSchema.required?.includes('projectId'), definition.name);
    await assert.rejects(runToolAndCapture(gitTools, definition.name, {}), ToolInputError, definition.name);
  }
});

test('git tools reject missing per-tool required arguments', async () => {
  const required: Array<[string, string]> = [
    ['git_diff', 'file'], ['git_file_with_diff', 'file'], ['git_commit_diff', 'commit'], ['git_compare', 'base'],
    ['git_compare_diff', 'file'], ['git_stage', 'files'], ['git_unstage', 'files'], ['git_discard', 'file'],
    ['git_delete_untracked', 'file'], ['git_commit', 'message'], ['git_generate_commit_message', 'files'],
    ['git_checkout', 'branch'], ['git_create_branch', 'branch'], ['git_delete_branch', 'branch'], ['git_publish', 'branch'],
  ];
  for (const [name, field] of required) {
    const full: Record<string, unknown> = { ...P, file: 'f', base: 'main', commit: 'c', files: ['f'], message: 'm', branch: 'b' };
    delete full[field];
    await assert.rejects(runToolAndCapture(gitTools, name, full), ToolInputError, `${name} without ${field}`);
  }
  await assert.rejects(runToolAndCapture(gitTools, 'git_compare_diff', { ...P, base: 'main' }), ToolInputError);
  await assert.rejects(runToolAndCapture(gitTools, 'git_commit', { ...P, message: 'm', files: [] }), ToolInputError);
});
