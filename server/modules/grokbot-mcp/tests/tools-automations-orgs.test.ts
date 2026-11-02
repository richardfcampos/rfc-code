import assert from 'node:assert/strict';
import test from 'node:test';

import { automationTools } from '@/modules/grokbot-mcp/tools/automations.tools.js';
import { orgTools } from '@/modules/grokbot-mcp/tools/orgs.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

test('automation_list GETs the collection', async () => {
  const { request } = await runToolAndCapture(automationTools, 'automation_list', {});
  assert.equal(request?.method, 'GET');
  assert.equal(request?.path, '/api/automations');
});

test('automation_create posts the snake_case body and omits unset optionals', async () => {
  const { request } = await runToolAndCapture(automationTools, 'automation_create', {
    name: 'nightly',
    trigger_kind: 'cron',
    trigger_config: { cron: '0 3 * * *' },
    action_kind: 'notify_push',
    action_config: { message: 'hi' },
    enabled: false,
  });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/automations');
  assert.deepEqual(request?.body, {
    name: 'nightly',
    trigger_kind: 'cron',
    action_kind: 'notify_push',
    action_config: { message: 'hi' },
    trigger_config: { cron: '0 3 * * *' },
    enabled: false,
  });
  const minimal = await runToolAndCapture(automationTools, 'automation_create', {
    name: 'hook',
    trigger_kind: 'webhook',
    action_kind: 'create_task',
    action_config: { project: 'p', title: 't' },
  });
  assert.deepEqual(Object.keys(minimal.request?.body as object).sort(), ['action_config', 'action_kind', 'name', 'trigger_kind']);
});

test('automation_create requires an action_config object', async () => {
  await assert.rejects(
    runToolAndCapture(automationTools, 'automation_create', { name: 'x', trigger_kind: 'webhook', action_kind: 'notify_push' }),
    ToolInputError,
  );
});

test('automation_get, delete, fire and rotate map to their routes', async () => {
  const cases: Array<[string, string, string]> = [
    ['automation_get', 'GET', '/api/automations/a1'],
    ['automation_delete', 'DELETE', '/api/automations/a1'],
    ['automation_fire', 'POST', '/api/automations/a1/fire'],
    ['automation_rotate_webhook_secret', 'POST', '/api/automations/a1/webhook-secret'],
  ];
  for (const [name, method, path] of cases) {
    const { request } = await runToolAndCapture(automationTools, name, { automationId: 'a1' });
    assert.equal(request?.method, method, name);
    assert.equal(request?.path, path, name);
    await assert.rejects(runToolAndCapture(automationTools, name, {}), ToolInputError);
  }
});

test('automation_update PATCHes only the given keys', async () => {
  const { request } = await runToolAndCapture(automationTools, 'automation_update', { automationId: 'a1', enabled: false });
  assert.equal(request?.method, 'PATCH');
  assert.equal(request?.path, '/api/automations/a1');
  assert.deepEqual(request?.body, { enabled: false });
});

test('automation_runs sends the limit as a query', async () => {
  const { request } = await runToolAndCapture(automationTools, 'automation_runs', { automationId: 'a1', limit: 10 });
  assert.equal(request?.method, 'GET');
  assert.equal(request?.path, '/api/automations/a1/runs');
  assert.deepEqual(request?.query, { limit: 10 });
});

test('org_list, org_create and org_update', async () => {
  const list = await runToolAndCapture(orgTools, 'org_list', {});
  assert.equal(list.request?.method, 'GET');
  assert.equal(list.request?.path, '/api/orgs');

  const create = await runToolAndCapture(orgTools, 'org_create', { name: 'Acme', fallbackThreshold: 80 });
  assert.equal(create.request?.method, 'POST');
  assert.equal(create.request?.path, '/api/orgs');
  assert.deepEqual(create.request?.body, { name: 'Acme', fallbackThreshold: 80 });
  await assert.rejects(runToolAndCapture(orgTools, 'org_create', {}), ToolInputError);

  const update = await runToolAndCapture(orgTools, 'org_update', { orgId: 'o1', name: 'New' });
  assert.equal(update.request?.method, 'PATCH');
  assert.equal(update.request?.path, '/api/orgs/o1');
  assert.deepEqual(update.request?.body, { name: 'New' });
});

test('org_delete, org_rule_add and org_rule_delete', async () => {
  const del = await runToolAndCapture(orgTools, 'org_delete', { orgId: 'o1' });
  assert.equal(del.request?.method, 'DELETE');
  assert.equal(del.request?.path, '/api/orgs/o1');
  await assert.rejects(runToolAndCapture(orgTools, 'org_delete', {}), ToolInputError);

  const add = await runToolAndCapture(orgTools, 'org_rule_add', { orgId: 'o1', kind: 'path_prefix', pattern: '/srv/code' });
  assert.equal(add.request?.method, 'POST');
  assert.equal(add.request?.path, '/api/orgs/o1/rules');
  assert.deepEqual(add.request?.body, { kind: 'path_prefix', pattern: '/srv/code' });

  const rule = await runToolAndCapture(orgTools, 'org_rule_delete', { orgId: 'o1', ruleId: 'r1' });
  assert.equal(rule.request?.method, 'DELETE');
  assert.equal(rule.request?.path, '/api/orgs/o1/rules/r1');
});

test('org_policies_replace sends the array itself as the body', async () => {
  const policies = [{ profileId: 'pr1', role: 'primary', priority: 1 }, { profileId: 'pr2', role: 'fallback' }];
  const { request } = await runToolAndCapture(orgTools, 'org_policies_replace', { orgId: 'o1', policies });
  assert.equal(request?.method, 'PUT');
  assert.equal(request?.path, '/api/orgs/o1/policies');
  assert.deepEqual(request?.body, policies);
  await assert.rejects(runToolAndCapture(orgTools, 'org_policies_replace', { orgId: 'o1', policies: 'x' }), ToolInputError);
  const cleared = await runToolAndCapture(orgTools, 'org_policies_replace', { orgId: 'o1', policies: [] });
  assert.deepEqual(cleared.request?.body, []);
});

test('org_allowed_profiles and org_recommend_profile pass project/provider as query', async () => {
  const allowed = await runToolAndCapture(orgTools, 'org_allowed_profiles', { project: '/srv/code/x', provider: 'claude' });
  assert.equal(allowed.request?.method, 'GET');
  assert.equal(allowed.request?.path, '/api/orgs/allowed-profiles');
  assert.deepEqual(allowed.request?.query, { project: '/srv/code/x', provider: 'claude' });

  const recommend = await runToolAndCapture(orgTools, 'org_recommend_profile', {});
  assert.equal(recommend.request?.method, 'GET');
  assert.equal(recommend.request?.path, '/api/orgs/recommend');
  assert.deepEqual(recommend.request?.query, { project: undefined, provider: undefined });
});
