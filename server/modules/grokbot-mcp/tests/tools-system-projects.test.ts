import assert from 'node:assert/strict';
import test from 'node:test';

import { projectTools } from '@/modules/grokbot-mcp/tools/projects.tools.js';
import { systemTools } from '@/modules/grokbot-mcp/tools/system.tools.js';
import { ToolInputError, seg } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

async function call(tools: typeof systemTools, name: string, args: Record<string, unknown> = {}) {
  const { request } = await runToolAndCapture(tools, name, args);
  return request;
}

test('system tools without arguments map to their routes', async () => {
  const cases: Array<[string, string, string]> = [
    ['health', 'GET', '/health'],
    ['system_update', 'POST', '/api/system/update'],
    ['auth_status', 'GET', '/api/auth/status'],
    ['user_onboarding_status', 'GET', '/api/user/onboarding-status'],
    ['user_complete_onboarding', 'POST', '/api/user/complete-onboarding'],
  ];
  for (const [name, method, path] of cases) {
    const request = await call(systemTools, name);
    assert.equal(request?.method, method, name);
    assert.equal(request?.path, path, name);
  }
});

test('filesystem_browse sends path as query only when given', async () => {
  assert.deepEqual((await call(systemTools, 'filesystem_browse', { path: '/srv' }))?.query, { path: '/srv' });
  const bare = await call(systemTools, 'filesystem_browse');
  assert.equal(bare?.path, '/api/browse-filesystem');
  assert.equal(bare?.query, undefined);
});

test('filesystem_create_folder posts the path and requires it', async () => {
  const request = await call(systemTools, 'filesystem_create_folder', { path: '/srv/new' });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/create-folder');
  assert.deepEqual(request?.body, { path: '/srv/new' });
  await assert.rejects(call(systemTools, 'filesystem_create_folder', {}), ToolInputError);
});

test('rfc_api_call forwards method, path, query and body verbatim', async () => {
  const request = await call(systemTools, 'rfc_api_call', {
    method: 'patch',
    path: '/api/tasks/t1',
    query: { force: true, n: 2, skip: null },
    body: { stage: 'done' },
  });
  assert.equal(request?.method, 'PATCH');
  assert.equal(request?.path, '/api/tasks/t1');
  assert.deepEqual(request?.query, { force: true, n: 2 });
  assert.deepEqual(request?.body, { stage: 'done' });
  assert.equal((await call(systemTools, 'rfc_api_call', { method: 'GET', path: '/health' }))?.path, '/health');
});

test('rfc_api_call refuses paths outside /api and bad methods', async () => {
  for (const path of ['/etc/passwd', 'http://evil/api/x', '/api/../index.html', '/api/x?y=1', '/apix', '/healthz']) {
    await assert.rejects(call(systemTools, 'rfc_api_call', { method: 'GET', path }), ToolInputError, path);
  }
  await assert.rejects(call(systemTools, 'rfc_api_call', { method: 'TRACE', path: '/api/x' }), ToolInputError);
  await assert.rejects(call(systemTools, 'rfc_api_call', { method: 'GET', path: '/api/x', query: { a: {} } }), ToolInputError);
  assert.deepEqual(systemTools.find((entry) => entry.name === 'rfc_api_call')?.covers, ['ALL /api/*']);
});

test('project_list maps skipSync and paging to the legacy query names', async () => {
  const request = await call(projectTools, 'project_list', { skipSync: true, sessionsLimit: 5, sessionsOffset: 10 });
  assert.equal(request?.method, 'GET');
  assert.equal(request?.path, '/api/projects');
  assert.deepEqual(request?.query, { skipSynchronization: '1', sessionsLimit: 5, sessionsOffset: 10 });
  assert.deepEqual((await call(projectTools, 'project_list'))?.query, {});
});

test('project_list_archived and project_create', async () => {
  assert.equal((await call(projectTools, 'project_list_archived'))?.path, '/api/projects/archived');
  const request = await call(projectTools, 'project_create', { path: '/srv/p', customName: 'P' });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/projects/create-project');
  assert.deepEqual(request?.body, { path: '/srv/p', customName: 'P' });
  assert.deepEqual((await call(projectTools, 'project_create', { path: '/srv/p' }))?.body, { path: '/srv/p' });
  await assert.rejects(call(projectTools, 'project_create', {}), ToolInputError);
});

test('project_clone streams SSE until complete or error', async () => {
  const request = await call(projectTools, 'project_clone', { path: '/srv/w', githubUrl: 'https://github.com/a/b', githubTokenId: 3 });
  assert.equal(request?.method, 'GET');
  assert.equal(request?.path, '/api/projects/clone-progress');
  assert.deepEqual(request?.query, { path: '/srv/w', githubUrl: 'https://github.com/a/b', githubTokenId: 3 });
  assert.equal(request?.responseType, 'sse');
  assert.equal(request?.sseUntil?.({ type: 'complete' }), true);
  assert.equal(request?.sseUntil?.({ type: 'error' }), true);
  assert.equal(request?.sseUntil?.({ type: 'progress' }), false);
  const withToken = await call(projectTools, 'project_clone', { path: '/w', githubUrl: 'u', newGithubToken: 'tok' });
  assert.deepEqual(withToken?.query, { path: '/w', githubUrl: 'u', newGithubToken: 'tok' });
  await assert.rejects(call(projectTools, 'project_clone', { path: '/w' }), ToolInputError);
});

test('project_rename, toggles and restore use the project path', async () => {
  const rename = await call(projectTools, 'project_rename', { projectId: 'p 1', displayName: 'New' });
  assert.equal(rename?.method, 'PUT');
  assert.equal(rename?.path, '/api/projects/p%201/rename');
  assert.deepEqual(rename?.body, { displayName: 'New' });
  const cases: Array<[string, string]> = [
    ['project_toggle_star', '/api/projects/p1/toggle-star'],
    ['project_toggle_notify', '/api/projects/p1/toggle-notify'],
    ['project_restore', '/api/projects/p1/restore'],
    ['project_codegraph_init', '/api/projects/p1/codegraph/init'],
  ];
  for (const [name, path] of cases) {
    const request = await call(projectTools, name, { projectId: 'p1' });
    assert.equal(request?.method, 'POST', name);
    assert.equal(request?.path, path, name);
  }
  await assert.rejects(call(projectTools, 'project_rename', { projectId: 'p1' }), ToolInputError);
});

test('project_archive and project_delete share the route, delete forces', async () => {
  const archive = await call(projectTools, 'project_archive', { projectId: 'p1' });
  assert.equal(archive?.method, 'DELETE');
  assert.equal(archive?.path, '/api/projects/p1');
  assert.equal(archive?.query, undefined);
  const hard = await call(projectTools, 'project_delete', { projectId: 'p1' });
  assert.equal(hard?.path, '/api/projects/p1');
  assert.deepEqual(hard?.query, { force: true });
  await assert.rejects(call(projectTools, 'project_delete', {}), ToolInputError);
});

test('project_sessions and status reads', async () => {
  const sessions = await call(projectTools, 'project_sessions', { projectId: 'p1', limit: 10, offset: 20 });
  assert.equal(sessions?.path, '/api/projects/p1/sessions');
  assert.deepEqual(sessions?.query, { limit: 10, offset: 20 });
  assert.equal((await call(projectTools, 'project_taskmaster_status', { projectId: 'p1' }))?.path, '/api/projects/p1/taskmaster');
  const codegraph = await call(projectTools, 'project_codegraph_status', { projectId: 'p1' });
  assert.equal(codegraph?.method, 'GET');
  assert.equal(codegraph?.path, '/api/projects/p1/codegraph');
});

test('project_migrate_legacy_stars posts the id list', async () => {
  const request = await call(projectTools, 'project_migrate_legacy_stars', { projectIds: ['a', 'b'] });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/projects/migrate-legacy-stars');
  assert.deepEqual(request?.body, { projectIds: ['a', 'b'] });
  await assert.rejects(call(projectTools, 'project_migrate_legacy_stars', { projectIds: [] }), ToolInputError);
});

test('rfc_api_call refuses encoded dot segments and its own endpoint, and normalises the path', async () => {
  await assert.rejects(
    runToolAndCapture(systemTools, 'rfc_api_call', { method: 'GET', path: '/api/%2e%2e/index.html' }),
    ToolInputError,
  );
  await assert.rejects(
    runToolAndCapture(systemTools, 'rfc_api_call', { method: 'POST', path: '/api/grokbot-mcp' }),
    ToolInputError,
  );
  const { request } = await runToolAndCapture(systemTools, 'rfc_api_call', { method: 'GET', path: '/api/tasks/./x' });
  assert.equal(request?.path, '/api/tasks/x');
});

test('seg refuses dot segments so an id cannot change the route', () => {
  assert.throws(() => seg('..'), ToolInputError);
  assert.throws(() => seg('.'), ToolInputError);
  assert.throws(() => seg('  '), ToolInputError);
  assert.equal(seg('a b/c'), 'a%20b%2Fc');
});
