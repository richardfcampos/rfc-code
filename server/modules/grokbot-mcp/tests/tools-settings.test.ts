import assert from 'node:assert/strict';
import test from 'node:test';

import { settingsTools } from '@/modules/grokbot-mcp/tools/settings.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';
import type { HttpMethod } from '@/modules/grokbot-mcp/grokbot-mcp.types.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

type Case = {
  name: string;
  args: Record<string, unknown>;
  method: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
};

const cases: Case[] = [
  { name: 'api_key_list', args: {}, method: 'GET', path: '/api/settings/api-keys' },
  { name: 'api_key_create', args: { keyName: 'bot' }, method: 'POST', path: '/api/settings/api-keys', body: { keyName: 'bot' } },
  { name: 'api_key_delete', args: { keyId: 'k/1' }, method: 'DELETE', path: '/api/settings/api-keys/k%2F1' },
  { name: 'api_key_toggle', args: { keyId: 'k1', isActive: false }, method: 'PATCH', path: '/api/settings/api-keys/k1/toggle', body: { isActive: false } },
  { name: 'credential_list', args: {}, method: 'GET', path: '/api/settings/credentials', query: { type: undefined } },
  { name: 'credential_list', args: { type: 'github' }, method: 'GET', path: '/api/settings/credentials', query: { type: 'github' } },
  {
    name: 'credential_create',
    args: { credentialName: 'n', credentialType: 't', credentialValue: 'v', description: 'd' },
    method: 'POST',
    path: '/api/settings/credentials',
    body: { credentialName: 'n', credentialType: 't', credentialValue: 'v', description: 'd' },
  },
  {
    name: 'credential_create',
    args: { credentialName: 'n', credentialType: 't', credentialValue: 'v' },
    method: 'POST',
    path: '/api/settings/credentials',
    body: { credentialName: 'n', credentialType: 't', credentialValue: 'v' },
  },
  { name: 'credential_delete', args: { credentialId: 'c1' }, method: 'DELETE', path: '/api/settings/credentials/c1' },
  { name: 'credential_toggle', args: { credentialId: 'c1', isActive: true }, method: 'PATCH', path: '/api/settings/credentials/c1/toggle', body: { isActive: true } },
  { name: 'notification_preferences_get', args: {}, method: 'GET', path: '/api/settings/notification-preferences' },
  {
    name: 'notification_preferences_set',
    args: { preferences: { channels: { push: true } } },
    method: 'PUT',
    path: '/api/settings/notification-preferences',
    body: { channels: { push: true } },
  },
  { name: 'notification_endpoints', args: { channel: 'push' }, method: 'GET', path: '/api/notifications/endpoints', query: { channel: 'push' } },
  {
    name: 'notification_endpoint_upsert',
    args: { channel: 'push', endpointId: 'e1', label: 'phone', metadata: { a: 1 }, enabled: false },
    method: 'POST',
    path: '/api/notifications/endpoints/current',
    body: { channel: 'push', endpointId: 'e1', label: 'phone', metadata: { a: 1 }, enabled: false },
  },
  {
    name: 'notification_endpoint_upsert',
    args: { channel: 'push', endpointId: 'e1' },
    method: 'POST',
    path: '/api/notifications/endpoints/current',
    body: { channel: 'push', endpointId: 'e1' },
  },
  {
    name: 'notification_endpoint_toggle',
    args: { channel: 'push', endpointId: 'e 1', enabled: true },
    method: 'PATCH',
    path: '/api/notifications/endpoints/push/e%201',
    body: { enabled: true },
  },
  { name: 'notification_endpoint_delete', args: { channel: 'push', endpointId: 'e1' }, method: 'DELETE', path: '/api/notifications/endpoints/push/e1' },
  { name: 'notify_hub_get', args: {}, method: 'GET', path: '/api/notifications/notify-hub' },
  {
    name: 'notify_hub_set',
    args: { url: 'https://hub', token: 't', timezone: 'UTC' },
    method: 'PUT',
    path: '/api/notifications/notify-hub',
    body: { url: 'https://hub', token: 't', timezone: 'UTC' },
  },
  { name: 'notify_hub_set', args: { url: 'https://hub' }, method: 'PUT', path: '/api/notifications/notify-hub', body: { url: 'https://hub' } },
  { name: 'notify_hub_test', args: {}, method: 'POST', path: '/api/notifications/notify-hub/test' },
  { name: 'git_identity_get', args: {}, method: 'GET', path: '/api/user/git-config' },
  {
    name: 'git_identity_set',
    args: { gitName: 'A', gitEmail: 'a@b.c' },
    method: 'POST',
    path: '/api/user/git-config',
    body: { gitName: 'A', gitEmail: 'a@b.c' },
  },
  { name: 'browser_use_settings_get', args: {}, method: 'GET', path: '/api/browser-use/settings' },
  { name: 'browser_use_settings_set', args: { enabled: true }, method: 'PUT', path: '/api/browser-use/settings', body: { enabled: true } },
  { name: 'browser_use_status', args: {}, method: 'GET', path: '/api/browser-use/status' },
  { name: 'browser_use_install_runtime', args: {}, method: 'POST', path: '/api/browser-use/runtime/install' },
  { name: 'browser_use_sessions', args: {}, method: 'GET', path: '/api/browser-use/sessions' },
  { name: 'browser_use_session_stop', args: { sessionId: 's1' }, method: 'POST', path: '/api/browser-use/sessions/s1/stop' },
  { name: 'browser_use_session_delete', args: { sessionId: 's1' }, method: 'DELETE', path: '/api/browser-use/sessions/s1' },
];

for (const entry of cases) {
  test(`${entry.name} maps to ${entry.method} ${entry.path}`, async () => {
    const { request } = await runToolAndCapture(settingsTools, entry.name, entry.args);
    assert.equal(request?.method, entry.method);
    assert.equal(request?.path, entry.path);
    assert.deepEqual(request?.body, entry.body);
    assert.deepEqual(request?.query, entry.query);
  });
}

test('every settings tool is covered by a mapping case', () => {
  const tested = new Set(cases.map((entry) => entry.name));
  assert.deepEqual(settingsTools.map((entry) => entry.name).filter((name) => !tested.has(name)), []);
});

const missing: Array<[string, Record<string, unknown>]> = [
  ['api_key_create', {}],
  ['api_key_delete', { keyId: ' ' }],
  ['api_key_toggle', { keyId: 'k1' }],
  ['credential_create', { credentialName: 'n', credentialType: 't' }],
  ['credential_delete', {}],
  ['credential_toggle', { credentialId: 'c1' }],
  ['notification_preferences_set', {}],
  ['notification_endpoints', {}],
  ['notification_endpoint_upsert', { channel: 'push' }],
  ['notification_endpoint_toggle', { channel: 'push', endpointId: 'e1' }],
  ['notification_endpoint_delete', { channel: 'push' }],
  ['notify_hub_set', {}],
  ['git_identity_set', { gitName: 'A' }],
  ['browser_use_settings_set', {}],
  ['browser_use_session_stop', {}],
  ['browser_use_session_delete', {}],
];

for (const [name, args] of missing) {
  test(`${name} rejects missing required arguments`, async () => {
    await assert.rejects(() => runToolAndCapture(settingsTools, name, args), ToolInputError);
  });
}
