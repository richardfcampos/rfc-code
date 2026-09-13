import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import {
  appConfigDb,
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
} from '@/modules/database/index.js';
import { createNotificationEvent } from '@/modules/notifications/services/notification-orchestrator.service.js';
import {
  cancelPendingPermissionWebhook,
  isWebhookConfigured,
  PERMISSION_PENDING_THRESHOLD_MS,
  sendWebhookNotification,
} from '@/modules/notifications/services/webhook-notify-channel.service.js';

const PROJECT_PATH = '/workspace/notify-hub-project';

function restoreEnv(key, previous) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

// Both gates now read sqlite (app_config for the hub, projects for the bell),
// so every test runs against an isolated DB file like the repository tests do.
async function withIsolatedDatabase(runTest) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousUrl = process.env.NOTIFY_URL;
  const previousToken = process.env.NOTIFY_TOKEN;
  const previousTimezone = process.env.NOTIFY_TIMEZONE;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'notify-hub-channel-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  // The env fallback is exercised explicitly where it matters; elsewhere the
  // developer's own NOTIFY_* must not leak into the assertions.
  delete process.env.NOTIFY_URL;
  delete process.env.NOTIFY_TOKEN;
  delete process.env.NOTIFY_TIMEZONE;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('NOTIFY_URL', previousUrl);
    restoreEnv('NOTIFY_TOKEN', previousToken);
    restoreEnv('NOTIFY_TIMEZONE', previousTimezone);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function configureHub(url, token = 'db-token') {
  appConfigDb.set('notify_hub_url', url);
  appConfigDb.set('notify_hub_token', token);
  appConfigDb.set('notify_hub_timezone', 'America/Sao_Paulo');
}

function createProject(projectPath, notifyEnabled) {
  projectsDb.createProjectPath(projectPath);
  const row = projectsDb.getProjectPath(projectPath);
  projectsDb.updateProjectNotifyEnabledById(row.project_id, notifyEnabled);
  return projectsDb.getProjectPath(projectPath);
}

// Events are built through the orchestrator's factory so the channel is
// exercised against genuine emit-site shapes, not hand-rolled objects.
function stopEvent(meta = {}) {
  return createNotificationEvent({
    provider: 'claude',
    sessionId: null,
    kind: 'stop',
    code: 'run.stopped',
    meta: { stopReason: 'completed', sessionName: 'My Session', projectPath: PROJECT_PATH, startedAt: null, ...meta },
    severity: 'info',
  });
}

function permissionEvent(requestId, meta = {}) {
  return createNotificationEvent({
    provider: 'claude',
    sessionId: null,
    kind: 'action_required',
    code: 'permission.required',
    meta: { toolName: 'Bash', sessionName: 'My Session', requestId, projectPath: PROJECT_PATH, ...meta },
    severity: 'warning',
    requiresUserAction: true,
  });
}

function stubFetch(calls) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('ok');
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// Throwaway HTTP server recording inbound requests, pointed at by the DB config.
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

  try {
    await run(requests, `http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('nothing is sent when notify-hub is not configured', async () => {
  await withIsolatedDatabase(async () => {
    createProject(PROJECT_PATH, true);
    const calls = [];
    const restoreFetch = stubFetch(calls);

    try {
      assert.equal(isWebhookConfigured(), false);
      assert.equal(sendWebhookNotification({ event: stopEvent() }), undefined);
      await Promise.resolve();
      assert.equal(calls.length, 0);
    } finally {
      restoreFetch();
    }
  });
});

test('a project with the bell off is never pushed', async () => {
  await withIsolatedDatabase(async () => {
    configureHub('http://127.0.0.1:1');
    createProject(PROJECT_PATH, false);
    const calls = [];
    const restoreFetch = stubFetch(calls);

    try {
      assert.equal(isWebhookConfigured(), true);
      assert.equal(sendWebhookNotification({ event: stopEvent() }), undefined);
      await Promise.resolve();
      assert.equal(calls.length, 0);
    } finally {
      restoreFetch();
    }
  });
});

test('an event that resolves to no project is never pushed', async () => {
  await withIsolatedDatabase(async () => {
    configureHub('http://127.0.0.1:1');
    const calls = [];
    const restoreFetch = stubFetch(calls);

    try {
      const orphan = stopEvent({ projectPath: null });
      assert.equal(sendWebhookNotification({ event: orphan }), undefined);

      const unknownProject = stopEvent({ projectPath: '/workspace/never-registered' });
      assert.equal(sendWebhookNotification({ event: unknownProject }), undefined);

      await Promise.resolve();
      assert.equal(calls.length, 0);
    } finally {
      restoreFetch();
    }
  });
});

test('the bell on posts the PT-BR body with the token from the DB, not from env', async () => {
  await withIsolatedDatabase(async () => {
    await withNotifyHubServer(async (requests, url) => {
      configureHub(url, 'db-token');
      // A stale env pair must lose to what the operator saved in Settings.
      process.env.NOTIFY_URL = 'http://127.0.0.1:1';
      process.env.NOTIFY_TOKEN = 'env-token';
      createProject(PROJECT_PATH, true);

      await sendWebhookNotification({ event: stopEvent() });

      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].authorization, 'Bearer db-token');
      assert.match(requests[0].contentType, /application\/json/);
      assert.equal(requests[0].body.title, '✅ notify-hub-project — concluído');
      assert.equal(requests[0].body.priority, 'default');
      assert.match(requests[0].body.message, /^Fim \d{2}:\d{2}\nSessão: My Session$/);
      assert.equal(requests[0].body.metadata.event, 'end');
      assert.equal(requests[0].body.metadata.projectPath, PROJECT_PATH);
    });
  });
});

test('the project is recovered from sessions.project_path when the event has none', async () => {
  await withIsolatedDatabase(async () => {
    await withNotifyHubServer(async (requests, url) => {
      configureHub(url);
      // createSession registers the project row too; only the bell is ours to set.
      sessionsDb.createSession('provider-session-1', 'claude', PROJECT_PATH);
      const project = projectsDb.getProjectPath(PROJECT_PATH);
      projectsDb.updateProjectNotifyEnabledById(project.project_id, true);

      const event = createNotificationEvent({
        provider: 'claude',
        sessionId: 'provider-session-1',
        kind: 'error',
        code: 'run.failed',
        meta: { error: 'boom', sessionName: null },
        severity: 'error',
      });

      await sendWebhookNotification({ event });

      assert.equal(requests.length, 1);
      assert.equal(requests[0].body.title, '❌ notify-hub-project — falhou');
      assert.equal(requests[0].body.priority, 'high');
      assert.match(requests[0].body.message, /Erro: boom$/);
    });
  });
});

test('a down notify-hub never rejects into the session (fire-and-forget)', async () => {
  await withIsolatedDatabase(async () => {
    // Port 1 is privileged/unbound: the connection is refused promptly.
    configureHub('http://127.0.0.1:1');
    createProject(PROJECT_PATH, true);

    await assert.doesNotReject(async () => {
      await sendWebhookNotification({ event: stopEvent() });
    });
  });
});

test('a deferred permission fires only if still pending and the bell is still on', async () => {
  await withIsolatedDatabase(async () => {
    configureHub('http://127.0.0.1:1');
    const project = createProject(PROJECT_PATH, true);
    const calls = [];
    const restoreFetch = stubFetch(calls);
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      sendWebhookNotification({ event: permissionEvent('req-threshold') });

      mock.timers.tick(PERMISSION_PENDING_THRESHOLD_MS - 1);
      assert.equal(calls.length, 0);

      mock.timers.tick(1);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(calls.length, 1);
      assert.equal(calls[0].options.method, 'POST');
      assert.equal(calls[0].options.headers.Authorization, 'Bearer db-token');
      const body = JSON.parse(calls[0].options.body);
      assert.equal(body.title, '🙋 notify-hub-project — precisa de você');
      assert.equal(body.priority, 'high');
      assert.match(body.message, /Ferramenta "Bash" aguarda aprovação$/);

      // The bell can be switched off during the 60s window: the gate is re-read
      // at fire time, so the second approval must stay silent.
      projectsDb.updateProjectNotifyEnabledById(project.project_id, false);
      sendWebhookNotification({ event: permissionEvent('req-turned-off') });
      mock.timers.tick(PERMISSION_PENDING_THRESHOLD_MS + 1);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(calls.length, 1);
    } finally {
      mock.timers.reset();
      restoreFetch();
    }
  });
});

test('resolving a permission before the threshold cancels its webhook', async () => {
  await withIsolatedDatabase(async () => {
    configureHub('http://127.0.0.1:1');
    createProject(PROJECT_PATH, true);
    const calls = [];
    const restoreFetch = stubFetch(calls);
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      sendWebhookNotification({ event: permissionEvent('req-cancel') });
      cancelPendingPermissionWebhook('req-cancel');

      mock.timers.tick(PERMISSION_PENDING_THRESHOLD_MS + 1000);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(calls.length, 0);
    } finally {
      mock.timers.reset();
      restoreFetch();
    }
  });
});

test('non-webhook event codes are ignored', async () => {
  await withIsolatedDatabase(async () => {
    configureHub('http://127.0.0.1:1');
    createProject(PROJECT_PATH, true);
    const calls = [];
    const restoreFetch = stubFetch(calls);

    try {
      const event = createNotificationEvent({
        provider: 'claude',
        sessionId: null,
        kind: 'action_required',
        code: 'agent.notification',
        meta: { message: 'hi', projectPath: PROJECT_PATH },
      });

      assert.equal(sendWebhookNotification({ event }), undefined);
      await Promise.resolve();
      assert.equal(calls.length, 0);
    } finally {
      restoreFetch();
    }
  });
});
