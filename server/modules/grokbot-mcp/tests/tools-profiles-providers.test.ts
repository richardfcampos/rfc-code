import assert from 'node:assert/strict';
import test from 'node:test';

import { profileTools } from '@/modules/grokbot-mcp/tools/profiles.tools.js';
import { providerTools } from '@/modules/grokbot-mcp/tools/providers.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

test('profile_list and profile_create', async () => {
  const list = await runToolAndCapture(profileTools, 'profile_list', { provider: 'codex' });
  assert.equal(list.request?.method, 'GET');
  assert.equal(list.request?.path, '/api/profiles');
  assert.deepEqual(list.request?.query, { provider: 'codex' });

  const create = await runToolAndCapture(profileTools, 'profile_create', { provider: 'claude', name: 'Work' });
  assert.equal(create.request?.method, 'POST');
  assert.equal(create.request?.path, '/api/profiles');
  assert.deepEqual(create.request?.body, { provider: 'claude', name: 'Work' });
  await assert.rejects(runToolAndCapture(profileTools, 'profile_create', { provider: 'claude' }), ToolInputError);
});

test('profile_delete, status, skills and restore map to their routes', async () => {
  const cases: Array<[string, string, string]> = [
    ['profile_delete', 'DELETE', '/api/profiles/p1'],
    ['profile_status', 'GET', '/api/profiles/p1/status'],
    ['profile_skills', 'GET', '/api/profiles/p1/skills'],
    ['profile_skills_restore', 'POST', '/api/profiles/p1/skills/restore'],
  ];
  for (const [name, method, path] of cases) {
    const { request } = await runToolAndCapture(profileTools, name, { profileId: 'p1' });
    assert.equal(request?.method, method, name);
    assert.equal(request?.path, path, name);
    await assert.rejects(runToolAndCapture(profileTools, name, {}), ToolInputError);
  }
});

test('profile_set_default sends a boolean', async () => {
  const { request } = await runToolAndCapture(profileTools, 'profile_set_default', { profileId: 'p1', isDefault: true });
  assert.equal(request?.method, 'PATCH');
  assert.equal(request?.path, '/api/profiles/p1/default');
  assert.deepEqual(request?.body, { isDefault: true });
  await assert.rejects(runToolAndCapture(profileTools, 'profile_set_default', { profileId: 'p1' }), ToolInputError);
});

test('profile_set_tooling forwards present keys including null and skips absent ones', async () => {
  const { request } = await runToolAndCapture(profileTools, 'profile_set_tooling', { profileId: 'p1', cavemanMode: null, rtkMode: 'normal' });
  assert.equal(request?.method, 'PATCH');
  assert.equal(request?.path, '/api/profiles/p1/tooling');
  assert.deepEqual(request?.body, { cavemanMode: null, rtkMode: 'normal' });
  const partial = await runToolAndCapture(profileTools, 'profile_set_tooling', { profileId: 'p1', rtkMode: 'off' });
  assert.deepEqual(partial.request?.body, { rtkMode: 'off' });
});

test('profile_usage covers both the batch and the single-profile route', async () => {
  const all = await runToolAndCapture(profileTools, 'profile_usage', { force: true });
  assert.equal(all.request?.method, 'GET');
  assert.equal(all.request?.path, '/api/profiles/usage');
  assert.deepEqual(all.request?.query, { force: true });

  const one = await runToolAndCapture(profileTools, 'profile_usage', { profileId: 'p1' });
  assert.equal(one.request?.path, '/api/profiles/p1/usage');
});

test('profile_skills_set accepts an empty list and rejects non-arrays', async () => {
  const { request } = await runToolAndCapture(profileTools, 'profile_skills_set', { profileId: 'p1', enabled: [] });
  assert.equal(request?.method, 'PUT');
  assert.equal(request?.path, '/api/profiles/p1/skills');
  assert.deepEqual(request?.body, { enabled: [] });
  await assert.rejects(runToolAndCapture(profileTools, 'profile_skills_set', { profileId: 'p1', enabled: 'a' }), ToolInputError);
});

test('provider_auth_status, provider_models and provider_capabilities', async () => {
  const auth = await runToolAndCapture(providerTools, 'provider_auth_status', { provider: 'claude' });
  assert.equal(auth.request?.method, 'GET');
  assert.equal(auth.request?.path, '/api/providers/claude/auth/status');
  await assert.rejects(runToolAndCapture(providerTools, 'provider_auth_status', {}), ToolInputError);

  const models = await runToolAndCapture(providerTools, 'provider_models', { provider: 'codex', bypassCache: true });
  assert.equal(models.request?.path, '/api/providers/codex/models');
  assert.deepEqual(models.request?.query, { bypassCache: true });

  const all = await runToolAndCapture(providerTools, 'provider_capabilities', {});
  assert.equal(all.request?.path, '/api/providers/capabilities');
  const one = await runToolAndCapture(providerTools, 'provider_capabilities', { provider: 'cursor' });
  assert.equal(one.request?.path, '/api/providers/cursor/capabilities');
});

test('skill_list, skill_create and skill_delete', async () => {
  const list = await runToolAndCapture(providerTools, 'skill_list', { provider: 'claude', workspacePath: '/w', profileId: 'p1' });
  assert.equal(list.request?.method, 'GET');
  assert.equal(list.request?.path, '/api/providers/claude/skills');
  assert.deepEqual(list.request?.query, { workspacePath: '/w', profileId: 'p1' });

  const entries = [{ content: '# s', directoryName: 'my-skill', files: [{ relativePath: 'a.txt', content: 'x', encoding: 'utf8' }] }];
  const create = await runToolAndCapture(providerTools, 'skill_create', { provider: 'claude', entries });
  assert.equal(create.request?.method, 'POST');
  assert.equal(create.request?.path, '/api/providers/claude/skills');
  assert.deepEqual(create.request?.body, { entries });
  await assert.rejects(runToolAndCapture(providerTools, 'skill_create', { provider: 'claude', entries: [] }), ToolInputError);

  const del = await runToolAndCapture(providerTools, 'skill_delete', { provider: 'claude', directoryName: 'my-skill' });
  assert.equal(del.request?.method, 'DELETE');
  assert.equal(del.request?.path, '/api/providers/claude/skills/my-skill');
  await assert.rejects(runToolAndCapture(providerTools, 'skill_delete', { provider: 'claude' }), ToolInputError);
});

test('mcp_server_list and mcp_server_delete use scope/workspacePath as query', async () => {
  const list = await runToolAndCapture(providerTools, 'mcp_server_list', { provider: 'claude', scope: 'project', workspacePath: '/w' });
  assert.equal(list.request?.method, 'GET');
  assert.equal(list.request?.path, '/api/providers/claude/mcp/servers');
  assert.deepEqual(list.request?.query, { scope: 'project', workspacePath: '/w' });

  const del = await runToolAndCapture(providerTools, 'mcp_server_delete', { provider: 'claude', name: 'my srv', scope: 'user' });
  assert.equal(del.request?.method, 'DELETE');
  assert.equal(del.request?.path, '/api/providers/claude/mcp/servers/my%20srv');
  assert.deepEqual(del.request?.query, { scope: 'user', workspacePath: undefined });
});

test('mcp_server_upsert forwards only the server fields in the body', async () => {
  const { request } = await runToolAndCapture(providerTools, 'mcp_server_upsert', {
    provider: 'codex',
    name: 'srv',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'x'],
    env: { A: 'b' },
    scope: 'user',
  });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/providers/codex/mcp/servers');
  assert.deepEqual(request?.body, { name: 'srv', transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { A: 'b' }, scope: 'user' });
  await assert.rejects(
    runToolAndCapture(providerTools, 'mcp_server_upsert', { provider: 'codex', name: 'srv' }),
    ToolInputError,
  );
});

test('mcp_server_add_global posts without a provider', async () => {
  const { request } = await runToolAndCapture(providerTools, 'mcp_server_add_global', {
    name: 'srv',
    transport: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer x' },
    scope: 'project',
    workspacePath: '/w',
  });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/providers/mcp/servers/global');
  assert.deepEqual(request?.body, {
    name: 'srv',
    transport: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer x' },
    scope: 'project',
    workspacePath: '/w',
  });
});

test('cursor_config and taskmaster_mcp_server_status', async () => {
  const cursor = await runToolAndCapture(providerTools, 'cursor_config', {});
  assert.equal(cursor.request?.method, 'GET');
  assert.equal(cursor.request?.path, '/api/cursor/config');

  const status = await runToolAndCapture(providerTools, 'taskmaster_mcp_server_status', { projectId: 'p1' });
  assert.equal(status.request?.path, '/api/mcp-utils/taskmaster-server');
  assert.deepEqual(status.request?.query, { projectId: 'p1' });
});
