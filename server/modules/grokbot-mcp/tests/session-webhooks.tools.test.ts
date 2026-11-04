import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionWebhookTools } from '@/modules/grokbot-mcp/tools/session-webhooks.tools.js';
import { settingsNotificationTools } from '@/modules/grokbot-mcp/tools/settings-notifications.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

test('notification_endpoint_upsert folds the session webhook fields into metadata', async () => {
  const { request } = await runToolAndCapture(settingsNotificationTools, 'notification_endpoint_upsert', {
    channel: 'session_webhook',
    endpointId: 'james',
    label: 'James',
    url: 'https://bot.example/hook',
    secret: 'top',
    events: ['session.idle', 'session.error'],
    projects: ['p1'],
    sessions: ['s1'],
    metadata: { note: 'kept' },
  });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/notifications/endpoints/current');
  assert.deepEqual(request?.body, {
    channel: 'session_webhook',
    endpointId: 'james',
    label: 'James',
    metadata: { note: 'kept', url: 'https://bot.example/hook', secret: 'top', events: ['session.idle', 'session.error'], projects: ['p1'], sessions: ['s1'] },
  });
});

test('notification_endpoint_upsert without webhook fields sends the body exactly as before', async () => {
  const { request } = await runToolAndCapture(settingsNotificationTools, 'notification_endpoint_upsert', {
    channel: 'session_webhook',
    endpointId: 'james',
    enabled: false,
  });
  assert.deepEqual(request?.body, { channel: 'session_webhook', endpointId: 'james', enabled: false });
});

test('webhook fields on another channel and malformed lists are refused before any request', async () => {
  await assert.rejects(
    runToolAndCapture(settingsNotificationTools, 'notification_endpoint_upsert', { channel: 'push', endpointId: 'e1', url: 'https://x' }),
    ToolInputError,
  );
  await assert.rejects(
    runToolAndCapture(settingsNotificationTools, 'notification_endpoint_upsert', { channel: 'session_webhook', endpointId: 'e1', events: 'session.idle' }),
    ToolInputError,
  );
});

test('notification_endpoint_test posts to the endpoint test route', async () => {
  const { request } = await runToolAndCapture(sessionWebhookTools, 'notification_endpoint_test', { endpointId: 'ja mes' });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/notifications/session-webhooks/ja%20mes/test');
  await assert.rejects(runToolAndCapture(sessionWebhookTools, 'notification_endpoint_test', {}), ToolInputError);
});

test('notification_deliveries forwards only the filters that were given', async () => {
  const all = await runToolAndCapture(sessionWebhookTools, 'notification_deliveries', {});
  assert.equal(all.request?.method, 'GET');
  assert.equal(all.request?.path, '/api/notifications/session-webhooks/deliveries');
  assert.deepEqual(all.request?.query, {});

  const filtered = await runToolAndCapture(sessionWebhookTools, 'notification_deliveries', { endpointId: 'james', sessionId: 's1', limit: 5 });
  assert.deepEqual(filtered.request?.query, { endpointId: 'james', sessionId: 's1', limit: 5 });
  await assert.rejects(runToolAndCapture(sessionWebhookTools, 'notification_deliveries', { limit: 'x' }), ToolInputError);
});
