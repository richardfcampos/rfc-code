import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import {
  deriveAgentBridgeSecret,
  signAgentBridgeToken,
  verifyAgentBridgeToken,
} from '@/modules/agent-bridge/agent-bridge-token.js';
import {
  createAgentBridgeRouter,
  createAgentBridgeSessionTokenRouter,
} from '@/modules/agent-bridge/agent-bridge.routes.js';
import type {
  AgentBridgeRouterDeps,
  AgentBridgeSessionScope,
  AgentBridgeSessionTokenDeps,
} from '@/modules/agent-bridge/agent-bridge.types.js';
import { OrgPolicyError } from '@/modules/orgs/index.js';
import { AppError } from '@/shared/utils.js';

import { createBridgeDeps, SCOPE, TASK } from './support/fake-bridge-deps.js';

const SECRET = deriveAgentBridgeSecret('installation-root-secret');
const TOKEN = signAgentBridgeToken(SCOPE, SECRET);

type ErrorBody = { success: boolean; error: { code: string; message: string } };

/** Same envelope the server entrypoint's global error middleware produces. */
function attachErrorMiddleware(app: express.Express): void {
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
}

async function withServer(
  mount: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  mount(app);
  attachErrorMiddleware(app);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function routerDeps(overrides: Partial<AgentBridgeRouterDeps> = {}) {
  const deps = createBridgeDeps();
  const router: AgentBridgeRouterDeps = {
    ...deps,
    verifyToken: (token) => verifyAgentBridgeToken(token, SECRET),
    resolveSessionScope: (sessionId) => (sessionId === SCOPE.sessionId ? SCOPE : null),
    ...overrides,
  };
  return { router, spy: deps };
}

async function callTool(
  baseUrl: string,
  toolName: string,
  body: Record<string, unknown>,
  token: string | null = TOKEN,
) {
  return fetch(`${baseUrl}/api/agent-bridge/tools/${toolName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('a call without a bearer token is refused', async () => {
  const { router, spy } = routerDeps();

  await withServer(
    (app) => app.use('/api/agent-bridge', createAgentBridgeRouter(router)),
    async (baseUrl) => {
      const response = await callTool(baseUrl, 'task_list', {}, null);
      const payload = (await response.json()) as ErrorBody;

      assert.equal(response.status, 401);
      assert.equal(payload.error.code, 'AGENT_BRIDGE_UNAUTHORIZED');
    },
  );

  assert.equal(spy.createCalls.length, 0);
});

test('a forged token is refused', async () => {
  const { router } = routerDeps();
  const forged = signAgentBridgeToken(SCOPE, deriveAgentBridgeSecret('another-installation'));

  await withServer(
    (app) => app.use('/api/agent-bridge', createAgentBridgeRouter(router)),
    async (baseUrl) => {
      for (const token of [forged, 'garbage', `${TOKEN}x`]) {
        const response = await callTool(baseUrl, 'task_list', {}, token);
        const payload = (await response.json()) as ErrorBody;

        assert.equal(response.status, 401);
        assert.equal(payload.error.code, 'AGENT_BRIDGE_UNAUTHORIZED');
      }
    },
  );
});

test('a genuine token whose session is gone is refused', async () => {
  const { router, spy } = routerDeps({ resolveSessionScope: () => null });

  await withServer(
    (app) => app.use('/api/agent-bridge', createAgentBridgeRouter(router)),
    async (baseUrl) => {
      const response = await callTool(baseUrl, 'task_create', { title: 'Ship it' });
      const payload = (await response.json()) as ErrorBody;

      assert.equal(response.status, 410);
      assert.equal(payload.error.code, 'AGENT_BRIDGE_SESSION_GONE');
    },
  );

  assert.equal(spy.createCalls.length, 0);
});

test('an authenticated tool call answers the shared success envelope', async () => {
  const { router, spy } = routerDeps();

  await withServer(
    (app) => app.use('/api/agent-bridge', createAgentBridgeRouter(router)),
    async (baseUrl) => {
      const response = await callTool(baseUrl, 'task_create', { title: 'Ship it' });
      const payload = (await response.json()) as { success: boolean; data: { task: typeof TASK } };

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.data.task.id, TASK.id);
    },
  );

  assert.equal(spy.createCalls[0]?.project, SCOPE.projectName);
  assert.deepEqual(spy.broadcasts.map(([, action]) => action), ['created']);
});

test('a policy denial reaches the agent as 403 with the reason', async () => {
  const { router, spy } = routerDeps({
    policy: {
      assertProfileAllowed: () => {
        throw new OrgPolicyError('Profile "profile-9" is not allowed for this project.');
      },
    },
  });

  await withServer(
    (app) => app.use('/api/agent-bridge', createAgentBridgeRouter(router)),
    async (baseUrl) => {
      const response = await callTool(baseUrl, 'task_assign', { taskId: TASK.id, profileId: 'profile-9' });
      const payload = (await response.json()) as ErrorBody;

      assert.equal(response.status, 403);
      assert.equal(payload.error.code, 'ORG_POLICY_DENIED');
      assert.match(payload.error.message, /not allowed for this project/);
    },
  );

  assert.equal(spy.updateCalls.length, 0);
});

test('an unknown tool answers 404', async () => {
  const { router } = routerDeps();

  await withServer(
    (app) => app.use('/api/agent-bridge', createAgentBridgeRouter(router)),
    async (baseUrl) => {
      const response = await callTool(baseUrl, 'rm_rf', {});
      const payload = (await response.json()) as ErrorBody;

      assert.equal(response.status, 404);
      assert.equal(payload.error.code, 'AGENT_BRIDGE_UNKNOWN_TOOL');
    },
  );
});

function sessionTokenDeps(
  overrides: Partial<AgentBridgeSessionTokenDeps> = {},
): AgentBridgeSessionTokenDeps {
  return {
    resolveSessionScope: (sessionId) => (sessionId === SCOPE.sessionId ? SCOPE : null),
    mintToken: (scope: AgentBridgeSessionScope) => signAgentBridgeToken(scope, SECRET),
    describeRegistration: (_scope, token) => ({
      name: 'cloudcli-agent-bridge',
      transport: 'stdio',
      command: 'cloudcli',
      args: ['agent-bridge-mcp'],
      env: {
        CLOUDCLI_AGENT_BRIDGE_TOKEN: token,
        CLOUDCLI_AGENT_BRIDGE_API_URL: 'http://127.0.0.1:3001/api/agent-bridge',
      },
    }),
    ...overrides,
  };
}

test('session-token mints a token that verifies back to the session scope', async () => {
  await withServer(
    (app) => app.use('/api/agent-bridge/session-token', createAgentBridgeSessionTokenRouter(sessionTokenDeps())),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agent-bridge/session-token?sessionId=${SCOPE.sessionId}`);
      const payload = (await response.json()) as {
        data: { token: string; projectName: string; mcp: { env: Record<string, string> } };
      };

      assert.equal(response.status, 200);
      assert.equal(payload.data.projectName, SCOPE.projectName);
      assert.equal(payload.data.mcp.env.CLOUDCLI_AGENT_BRIDGE_TOKEN, payload.data.token);

      const verified = verifyAgentBridgeToken(payload.data.token, SECRET);
      assert.equal(verified?.sessionId, SCOPE.sessionId);
      assert.equal(verified?.projectName, SCOPE.projectName);
    },
  );
});

test('session-token validates its input and refuses a dead session', async () => {
  await withServer(
    (app) => app.use('/api/agent-bridge/session-token', createAgentBridgeSessionTokenRouter(sessionTokenDeps())),
    async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/agent-bridge/session-token`);
      assert.equal(missing.status, 400);
      assert.equal(((await missing.json()) as ErrorBody).error.code, 'AGENT_BRIDGE_VALIDATION_ERROR');

      const gone = await fetch(`${baseUrl}/api/agent-bridge/session-token?sessionId=session-404`);
      assert.equal(gone.status, 410);
      assert.equal(((await gone.json()) as ErrorBody).error.code, 'AGENT_BRIDGE_SESSION_GONE');
    },
  );
});
