import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import providerRoutes from '@/modules/providers/provider.routes.js';
import { AppError } from '@/shared/utils.js';

/**
 * Mounts the provider router on a throwaway server with the same AppError→status
 * mapping the production global error middleware applies, so route tests observe
 * the real status codes callers would receive. Auth is intentionally omitted:
 * the router's own logic is under test, not the shared auth middleware.
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
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-task-link-route-'));

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

// `json` is intentionally `any`: tests assert on the dynamic REST envelope shape.
type JsonResponse = { status: number; json: any };

async function putSession(baseUrl: string, sessionId: string, body: unknown): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}/api/providers/sessions/${sessionId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test('PUT /api/providers/sessions/:id sets taskId and returns it in the response', async () => {
  await withServer(async (baseUrl) => {
    sessionsDb.createAppSession('session-task-1', 'claude', '/workspace/demo-project');

    const { status, json } = await putSession(baseUrl, 'session-task-1', {
      summary: 'Working on the task',
      taskId: 'TASK-42',
    });

    assert.equal(status, 200);
    assert.equal(json.data.taskId, 'TASK-42');
    assert.equal(sessionsDb.getSessionById('session-task-1')?.task_id, 'TASK-42');
  });
});

test('PUT /api/providers/sessions/:id clears taskId when given null', async () => {
  await withServer(async (baseUrl) => {
    sessionsDb.createAppSession('session-task-2', 'claude', '/workspace/demo-project');
    sessionsDb.setTaskId('session-task-2', 'TASK-1');

    const { status, json } = await putSession(baseUrl, 'session-task-2', {
      summary: 'Still working',
      taskId: null,
    });

    assert.equal(status, 200);
    assert.equal(json.data.taskId, null);
    assert.equal(sessionsDb.getSessionById('session-task-2')?.task_id, null);
  });
});

test('PUT /api/providers/sessions/:id leaves taskId untouched when omitted', async () => {
  await withServer(async (baseUrl) => {
    sessionsDb.createAppSession('session-task-3', 'claude', '/workspace/demo-project');
    sessionsDb.setTaskId('session-task-3', 'TASK-9');

    const { status, json } = await putSession(baseUrl, 'session-task-3', {
      summary: 'Renamed without touching the task link',
    });

    assert.equal(status, 200);
    assert.equal(json.data.taskId, 'TASK-9');
    assert.equal(sessionsDb.getSessionById('session-task-3')?.task_id, 'TASK-9');
  });
});

test('PUT /api/providers/sessions/:id rejects a non-string, non-null taskId with 400', async () => {
  await withServer(async (baseUrl) => {
    sessionsDb.createAppSession('session-task-4', 'claude', '/workspace/demo-project');

    const { status, json } = await putSession(baseUrl, 'session-task-4', {
      summary: 'Bad taskId',
      taskId: 42,
    });

    assert.equal(status, 400);
    assert.equal(json.error.code, 'INVALID_TASK_ID');
    assert.equal(sessionsDb.getSessionById('session-task-4')?.task_id, null);
  });
});

test('PUT /api/providers/sessions/:id rejects a taskId over the length cap with 400', async () => {
  await withServer(async (baseUrl) => {
    sessionsDb.createAppSession('session-task-5', 'claude', '/workspace/demo-project');

    const { status, json } = await putSession(baseUrl, 'session-task-5', {
      summary: 'Too long',
      taskId: 'x'.repeat(65),
    });

    assert.equal(status, 400);
    assert.equal(json.error.code, 'INVALID_TASK_ID');
  });
});
