import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { configureRunningSessionsAttention } from '@/modules/providers/index.js';
import providerRoutes from '@/modules/providers/provider.routes.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

/**
 * Mounts the provider router on a throwaway server with the same AppError→status
 * mapping the production global error middleware applies. Auth is intentionally
 * omitted: the router's own logic is under test, not the shared auth middleware.
 */
function buildTestApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/providers', providerRoutes);
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({
          success: false,
          error: { code: err.code, message: err.message },
        });
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
    },
  );
  return app;
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'running-sessions-route-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const server = http.createServer(buildTestApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    chatRunRegistry.clearAll();
    configureRunningSessionsAttention(() => []);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Never-open stub socket: registered runs must not need a live client. */
const stubConnection = { readyState: 0, send: () => {} };

// `json` is intentionally `any`: tests assert on the dynamic REST envelope shape.
async function getRunningSessions(baseUrl: string): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}/api/providers/sessions/running`);
  return { status: response.status, json: await response.json() };
}

test('GET /api/providers/sessions/running returns an empty list when nothing runs', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await getRunningSessions(baseUrl);

    assert.equal(status, 200);
    assert.deepEqual(json.data.sessions, []);
  });
});

test('GET /api/providers/sessions/running flags a run blocked on a tool approval', async () => {
  await withServer(async (baseUrl) => {
    chatRunRegistry.startRun({
      appSessionId: 'session-approval-1',
      provider: 'claude',
      providerSessionId: 'provider-approval-1',
      connection: stubConnection,
      userId: null,
    });
    configureRunningSessionsAttention((providerSessionId) =>
      providerSessionId === 'provider-approval-1'
        ? [{ requestId: 'req-1', toolName: 'Bash' }]
        : [],
    );

    const { status, json } = await getRunningSessions(baseUrl);

    assert.equal(status, 200);
    assert.equal(json.data.sessions.length, 1);
    const [session] = json.data.sessions;
    assert.equal(session.sessionId, 'session-approval-1');
    assert.equal(session.provider, 'claude');
    assert.equal(typeof session.startedAt, 'number');
    assert.equal(session.lastSeq, 0);
    assert.equal(session.needsAttention, true);
    assert.equal(session.statusText, 'Waiting for approval: Bash');
    assert.equal(session.canInterrupt, true);
  });
});

test('GET /api/providers/sessions/running reports a plain run as not needing attention', async () => {
  await withServer(async (baseUrl) => {
    chatRunRegistry.startRun({
      appSessionId: 'session-plain-1',
      provider: 'claude',
      providerSessionId: 'provider-plain-1',
      connection: stubConnection,
      userId: null,
    });
    configureRunningSessionsAttention(() => []);

    const { json } = await getRunningSessions(baseUrl);

    assert.equal(json.data.sessions.length, 1);
    const [session] = json.data.sessions;
    assert.equal(session.needsAttention, false);
    assert.equal(session.statusText, null);
    assert.equal(session.canInterrupt, true);
  });
});

test('GET /api/providers/sessions/running never consults approvals before the provider id exists', async () => {
  await withServer(async (baseUrl) => {
    chatRunRegistry.startRun({
      appSessionId: 'session-fresh-1',
      provider: 'claude',
      providerSessionId: null,
      connection: stubConnection,
      userId: null,
    });
    configureRunningSessionsAttention(() => {
      throw new Error('lookup must not be called without a provider session id');
    });

    const { status, json } = await getRunningSessions(baseUrl);

    assert.equal(status, 200);
    const [session] = json.data.sessions;
    assert.equal(session.needsAttention, false);
    assert.equal(session.statusText, null);
    // No provider-native id yet means the runtime cannot be addressed to abort.
    assert.equal(session.canInterrupt, false);
  });
});
