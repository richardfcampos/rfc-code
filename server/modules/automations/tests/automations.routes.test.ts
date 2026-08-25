import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { createAutomationAdminService } from '@/modules/automations/services/automation-admin.service.js';
import { createAutomationTriggerService } from '@/modules/automations/services/automation-triggers.service.js';
import {
  createAutomationWebhookRouter,
  createAutomationsRouter,
  type AutomationRouterDeps,
} from '@/modules/automations/automations.routes.js';
import { createAutomationFiringService } from '@/modules/automations/automations.service.js';
import { AppError } from '@/shared/utils.js';

import { createFakeDeps, type FakeAutomationDeps } from './support/fake-automation-deps.js';

// Same shape the other route suites use: response bodies are read positionally
// here, and re-declaring every view type would only duplicate the module under
// test without making the assertions any stricter.
type Envelope = { success: boolean; data?: any; error?: any };

/** Same envelope the entrypoint's global error middleware produces. */
function attachErrorMiddleware(app: express.Express): void {
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
}

async function withServer(
  run: (
    request: (method: string, path: string, options?: { body?: unknown; headers?: Record<string, string> }) => Promise<{
      status: number;
      body: Envelope & Record<string, unknown>;
    }>,
    deps: FakeAutomationDeps,
  ) => Promise<void>,
): Promise<void> {
  const fake = createFakeDeps();
  const firing = createAutomationFiringService(fake);
  const routerDeps: AutomationRouterDeps = {
    admin: createAutomationAdminService(fake.repository),
    firing,
    triggers: createAutomationTriggerService(fake, firing),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/automations/webhook', createAutomationWebhookRouter(routerDeps));
  app.use('/api/automations', createAutomationsRouter(routerDeps));
  attachErrorMiddleware(app);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  try {
    await run(async (method, path, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { status: response.status, body: (await response.json()) as Envelope & Record<string, unknown> };
    }, fake);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const CRON_RULE = {
  name: 'Nightly sweep',
  trigger_kind: 'cron',
  trigger_config: { cron: '0 3 * * *' },
  action_kind: 'notify_push',
  action_config: { message: 'Swept' },
};

test('a rule can be created, read, listed, updated and deleted', async () => {
  await withServer(async (request) => {
    const created = await request('POST', '/api/automations', { body: CRON_RULE });
    assert.equal(created.status, 201);
    const automation = created.body.data.automation;
    assert.equal(automation.enabled, true);
    assert.deepEqual(automation.triggerConfig, { cron: '0 3 * * *' });

    const listed = await request('GET', '/api/automations');
    assert.equal(listed.body.data.automations.length, 1);

    const fetched = await request('GET', `/api/automations/${automation.automationId}`);
    assert.equal(fetched.body.data.automation.name, 'Nightly sweep');

    const patched = await request('PATCH', `/api/automations/${automation.automationId}`, {
      body: { enabled: false, trigger_config: { cron: '*/5 * * * *' } },
    });
    assert.equal(patched.body.data.automation.enabled, false);
    assert.deepEqual(patched.body.data.automation.triggerConfig, { cron: '*/5 * * * *' });

    const removed = await request('DELETE', `/api/automations/${automation.automationId}`);
    assert.equal(removed.status, 200);
    assert.equal((await request('GET', '/api/automations')).body.data.automations.length, 0);
  });
});

test('an invalid rule is refused with a named error', async () => {
  await withServer(async (request) => {
    const noName = await request('POST', '/api/automations', { body: { ...CRON_RULE, name: '  ' } });
    assert.equal(noName.status, 400);
    assert.equal(noName.body.error.code, 'AUTOMATION_VALIDATION_ERROR');

    const badCron = await request('POST', '/api/automations', {
      body: { ...CRON_RULE, trigger_config: { cron: '99 * * * *' } },
    });
    assert.equal(badCron.status, 400);
    assert.match(badCron.body.error.message, /trigger_config.cron is invalid/);

    const badKind = await request('POST', '/api/automations', { body: { ...CRON_RULE, action_kind: 'delete_repo' } });
    assert.equal(badKind.status, 400);
  });
});

test('an unknown rule is a 404 on the management surface', async () => {
  await withServer(async (request) => {
    const response = await request('GET', '/api/automations/missing');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'AUTOMATION_NOT_FOUND');
  });
});

test('creating a webhook rule returns its secret exactly once', async () => {
  await withServer(async (request) => {
    const created = await request('POST', '/api/automations', {
      body: { ...CRON_RULE, trigger_kind: 'webhook', trigger_config: {} },
    });

    const secret = created.body.data.secret;
    assert.equal(typeof secret, 'string');
    assert.ok(secret.length >= 32);
    assert.deepEqual(created.body.data.automation.triggerConfig, { hasSecret: true });

    const fetched = await request('GET', `/api/automations/${created.body.data.automation.automationId}`);
    assert.equal(fetched.body.data.automation.secret, undefined);
    assert.equal(JSON.stringify(fetched.body).includes(secret), false);
  });
});

test('a webhook fires only when the right secret is presented', async () => {
  await withServer(async (request, deps) => {
    const created = await request('POST', '/api/automations', {
      body: { ...CRON_RULE, trigger_kind: 'webhook', trigger_config: {}, action_config: { message: 'ping' } },
    });
    const id = created.body.data.automation.automationId;
    const secret = created.body.data.secret as string;
    const url = `/api/automations/webhook/${id}`;

    const noSecret = await request('POST', url, { body: {} });
    assert.equal(noSecret.status, 401);
    assert.equal(noSecret.body.error.code, 'AUTOMATION_WEBHOOK_UNAUTHORIZED');

    const wrongSecret = await request('POST', url, { body: {}, headers: { 'x-automation-secret': 'nope' } });
    assert.equal(wrongSecret.status, 401);

    const almostRight = await request('POST', url, {
      body: {},
      headers: { 'x-automation-secret': `${secret}x` },
    });
    assert.equal(almostRight.status, 401);
    assert.equal(deps.pushes.length, 0);

    const accepted = await request('POST', url, { body: {}, headers: { 'x-automation-secret': secret } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.result.status, 'success');
    assert.equal(deps.pushes.length, 1);

    const asBearer = await request('POST', url, { body: {}, headers: { authorization: `Bearer ${secret}` } });
    assert.equal(asBearer.status, 200);
    assert.equal(deps.pushes.length, 2);
  });
});

test('an unknown, disabled or non-webhook automation answers the webhook exactly like a wrong secret', async () => {
  await withServer(async (request, deps) => {
    const created = await request('POST', '/api/automations', {
      body: { ...CRON_RULE, trigger_kind: 'webhook', trigger_config: {} },
    });
    const id = created.body.data.automation.automationId;
    const secret = created.body.data.secret as string;

    const unknown = await request('POST', '/api/automations/webhook/does-not-exist', {
      body: {},
      headers: { 'x-automation-secret': secret },
    });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.code, 'AUTOMATION_WEBHOOK_UNAUTHORIZED');

    await request('PATCH', `/api/automations/${id}`, { body: { enabled: false } });
    const disabled = await request('POST', `/api/automations/webhook/${id}`, {
      body: {},
      headers: { 'x-automation-secret': secret },
    });
    assert.equal(disabled.status, 401);
    assert.equal(deps.pushes.length, 0);
  });
});

test('a repeated delivery of the same webhook id is skipped', async () => {
  await withServer(async (request, deps) => {
    const created = await request('POST', '/api/automations', {
      body: { ...CRON_RULE, trigger_kind: 'webhook', trigger_config: {} },
    });
    const url = `/api/automations/webhook/${created.body.data.automation.automationId}`;
    const headers = { 'x-automation-secret': created.body.data.secret as string, 'x-idempotency-key': 'delivery-9' };

    assert.equal((await request('POST', url, { body: {}, headers })).body.data.result.status, 'success');
    assert.equal((await request('POST', url, { body: {}, headers })).body.data.result.status, 'skipped');
    assert.equal(deps.pushes.length, 1);
  });
});

test('rotating a secret invalidates the previous one', async () => {
  await withServer(async (request) => {
    const created = await request('POST', '/api/automations', {
      body: { ...CRON_RULE, trigger_kind: 'webhook', trigger_config: {} },
    });
    const id = created.body.data.automation.automationId;
    const url = `/api/automations/webhook/${id}`;
    const oldSecret = created.body.data.secret as string;

    const rotated = await request('POST', `/api/automations/${id}/webhook-secret`);
    const newSecret = rotated.body.data.secret as string;
    assert.notEqual(newSecret, oldSecret);

    assert.equal((await request('POST', url, { body: {}, headers: { 'x-automation-secret': oldSecret } })).status, 401);
    assert.equal((await request('POST', url, { body: {}, headers: { 'x-automation-secret': newSecret } })).status, 200);
  });
});

test('rotating the secret of a non-webhook rule is refused', async () => {
  await withServer(async (request) => {
    const created = await request('POST', '/api/automations', { body: CRON_RULE });
    const response = await request(
      'POST',
      `/api/automations/${created.body.data.automation.automationId}/webhook-secret`,
    );

    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /Only webhook automations/);
  });
});

test('a manual fire runs the rule and shows up in its history', async () => {
  await withServer(async (request, deps) => {
    const created = await request('POST', '/api/automations', { body: CRON_RULE });
    const id = created.body.data.automation.automationId;

    const fired = await request('POST', `/api/automations/${id}/fire`);
    assert.equal(fired.body.data.result.status, 'success');
    assert.equal(deps.pushes.length, 1);

    const history = await request('GET', `/api/automations/${id}/runs`);
    assert.equal(history.body.data.runs.length, 1);
    assert.equal(history.body.data.runs[0].status, 'success');
    assert.equal(history.body.data.runs[0].attempt, 1);
  });
});

test('the history limit is validated', async () => {
  await withServer(async (request) => {
    const created = await request('POST', '/api/automations', { body: CRON_RULE });
    const id = created.body.data.automation.automationId;

    assert.equal((await request('GET', `/api/automations/${id}/runs?limit=10`)).status, 200);
    assert.equal((await request('GET', `/api/automations/${id}/runs?limit=0`)).status, 400);
    assert.equal((await request('GET', `/api/automations/${id}/runs?limit=999`)).status, 400);
    assert.equal((await request('GET', `/api/automations/${id}/runs?limit=abc`)).status, 400);
  });
});
