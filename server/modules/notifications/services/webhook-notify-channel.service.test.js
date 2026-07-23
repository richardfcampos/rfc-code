import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test, { mock } from 'node:test';

import {
  buildNotificationPayload,
  createNotificationEvent,
} from '@/modules/notifications/services/notification-orchestrator.service.js';
import {
  buildWebhookRequestBody,
  cancelPendingPermissionWebhook,
  isWebhookConfigured,
  PERMISSION_PENDING_THRESHOLD_MS,
  sendWebhookNotification,
} from '@/modules/notifications/services/webhook-notify-channel.service.js';

function restoreEnv(key, previous) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

// Builds events exactly as the real emit sites do (notifyRunStopped/Failed and
// the Claude canUseTool permission prompt), so the webhook is exercised against
// genuine orchestrator payloads rather than hand-rolled shapes.
function stopEvent() {
  return createNotificationEvent({
    provider: 'claude',
    sessionId: null,
    kind: 'stop',
    code: 'run.stopped',
    meta: { stopReason: 'completed', sessionName: 'My Session' },
    severity: 'info',
  });
}

function failEvent() {
  return createNotificationEvent({
    provider: 'claude',
    sessionId: null,
    kind: 'error',
    code: 'run.failed',
    meta: { error: 'boom', sessionName: 'My Session' },
    severity: 'error',
  });
}

function permissionEvent(requestId) {
  return createNotificationEvent({
    provider: 'claude',
    sessionId: null,
    kind: 'action_required',
    code: 'permission.required',
    meta: { toolName: 'Bash', sessionName: 'My Session', requestId },
    severity: 'warning',
    requiresUserAction: true,
  });
}

// Spins up a throwaway HTTP server that records each inbound request, points the
// channel env at it, and restores env + closes the server afterwards.
async function withNotifyHubServer(run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        authorization: req.headers['authorization'],
        contentType: req.headers['content-type'],
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const previousUrl = process.env.NOTIFY_URL;
  const previousToken = process.env.NOTIFY_TOKEN;
  process.env.NOTIFY_URL = `http://127.0.0.1:${port}`;
  process.env.NOTIFY_TOKEN = 'test-token';

  try {
    await run(requests);
  } finally {
    restoreEnv('NOTIFY_URL', previousUrl);
    restoreEnv('NOTIFY_TOKEN', previousToken);
    server.close();
    await once(server, 'close');
  }
}

test('run.stopped posts the notify-hub wire format (POST + bearer + body)', async () => {
  await withNotifyHubServer(async (requests) => {
    const event = stopEvent();
    const payload = buildNotificationPayload(event);

    await sendWebhookNotification({ event, payload });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].authorization, 'Bearer test-token');
    assert.match(requests[0].contentType, /application\/json/);
    assert.deepEqual(requests[0].body, {
      title: 'My Session',
      message: 'Claude: completed',
      priority: 'default',
    });
  });
});

test('run.failed posts with high priority and the error message', async () => {
  await withNotifyHubServer(async (requests) => {
    const event = failEvent();
    const payload = buildNotificationPayload(event);

    await sendWebhookNotification({ event, payload });

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body, {
      title: 'My Session',
      message: 'Claude: Run Failed: boom',
      priority: 'high',
    });
  });
});

test('request body maps priority per event code', () => {
  assert.equal(buildWebhookRequestBody(stopEvent(), { title: 't', body: 'b' }).priority, 'default');
  assert.equal(buildWebhookRequestBody(failEvent(), { title: 't', body: 'b' }).priority, 'high');
  assert.equal(buildWebhookRequestBody(permissionEvent('r'), { title: 't', body: 'b' }).priority, 'high');

  assert.deepEqual(buildWebhookRequestBody(stopEvent(), { title: 'Sess', body: 'msg' }), {
    title: 'Sess',
    message: 'msg',
    priority: 'default',
  });
});

test('channel is disabled and posts nothing when env is absent', async () => {
  const previousUrl = process.env.NOTIFY_URL;
  const previousToken = process.env.NOTIFY_TOKEN;
  delete process.env.NOTIFY_URL;
  delete process.env.NOTIFY_TOKEN;

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response('ok');
  };

  try {
    assert.equal(isWebhookConfigured(), false);

    const event = stopEvent();
    const result = sendWebhookNotification({
      event,
      payload: buildWebhookRequestBody(event, { title: 't', body: 'b' }),
    });

    assert.equal(result, undefined);
    await Promise.resolve();
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('NOTIFY_URL', previousUrl);
    restoreEnv('NOTIFY_TOKEN', previousToken);
  }
});

test('a down notify-hub never rejects into the session (fire-and-forget)', async () => {
  const previousUrl = process.env.NOTIFY_URL;
  const previousToken = process.env.NOTIFY_TOKEN;
  // Port 1 is privileged/unbound: the connection is refused promptly.
  process.env.NOTIFY_URL = 'http://127.0.0.1:1';
  process.env.NOTIFY_TOKEN = 'test-token';

  try {
    const event = stopEvent();
    const payload = buildWebhookRequestBody(event, { title: 't', body: 'b' });

    await assert.doesNotReject(async () => {
      await sendWebhookNotification({ event, payload });
    });
  } finally {
    restoreEnv('NOTIFY_URL', previousUrl);
    restoreEnv('NOTIFY_TOKEN', previousToken);
  }
});

test('permission.required posts only once still pending past the threshold', async () => {
  const previousUrl = process.env.NOTIFY_URL;
  const previousToken = process.env.NOTIFY_TOKEN;
  process.env.NOTIFY_URL = 'http://127.0.0.1:1';
  process.env.NOTIFY_TOKEN = 'test-token';

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('ok');
  };
  mock.timers.enable({ apis: ['setTimeout'] });

  try {
    const event = permissionEvent('req-threshold');
    const payload = buildWebhookRequestBody(event, {
      title: 'Sess',
      body: 'Claude: Action Required: Tool "Bash" needs approval',
    });

    sendWebhookNotification({ event, payload });

    mock.timers.tick(PERMISSION_PENDING_THRESHOLD_MS - 1);
    assert.equal(calls.length, 0);

    mock.timers.tick(1);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(JSON.parse(calls[0].options.body).priority, 'high');
  } finally {
    mock.timers.reset();
    globalThis.fetch = originalFetch;
    restoreEnv('NOTIFY_URL', previousUrl);
    restoreEnv('NOTIFY_TOKEN', previousToken);
  }
});

test('resolving a permission before the threshold cancels its webhook', async () => {
  const previousUrl = process.env.NOTIFY_URL;
  const previousToken = process.env.NOTIFY_TOKEN;
  process.env.NOTIFY_URL = 'http://127.0.0.1:1';
  process.env.NOTIFY_TOKEN = 'test-token';

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('ok');
  };
  mock.timers.enable({ apis: ['setTimeout'] });

  try {
    const event = permissionEvent('req-cancel');
    const payload = buildWebhookRequestBody(event, { title: 'Sess', body: 'approve' });

    sendWebhookNotification({ event, payload });
    cancelPendingPermissionWebhook('req-cancel');

    mock.timers.tick(PERMISSION_PENDING_THRESHOLD_MS + 1000);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 0);
  } finally {
    mock.timers.reset();
    globalThis.fetch = originalFetch;
    restoreEnv('NOTIFY_URL', previousUrl);
    restoreEnv('NOTIFY_TOKEN', previousToken);
  }
});

test('non-webhook event codes are ignored', async () => {
  const previousUrl = process.env.NOTIFY_URL;
  const previousToken = process.env.NOTIFY_TOKEN;
  process.env.NOTIFY_URL = 'http://127.0.0.1:1';
  process.env.NOTIFY_TOKEN = 'test-token';

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response('ok');
  };

  try {
    const event = createNotificationEvent({
      provider: 'claude',
      sessionId: null,
      kind: 'action_required',
      code: 'agent.notification',
      meta: { message: 'hi' },
    });

    const result = sendWebhookNotification({ event, payload: { title: 't', body: 'b' } });

    assert.equal(result, undefined);
    await Promise.resolve();
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('NOTIFY_URL', previousUrl);
    restoreEnv('NOTIFY_TOKEN', previousToken);
  }
});
