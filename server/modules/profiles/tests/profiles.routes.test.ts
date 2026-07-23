import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  sessionsDb,
} from '@/modules/database/index.js';
import profilesRoutes from '@/modules/profiles/profiles.routes.js';
import { AppError } from '@/shared/utils.js';

/**
 * Mounts the profiles router on a throwaway server with the same AppError→status
 * mapping the production global error middleware applies, so route tests observe
 * the real status codes callers would receive. Auth is intentionally omitted:
 * the router's own logic is under test, not the shared auth middleware.
 */
function buildTestApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/profiles', profilesRoutes);
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
  const previousProfilesRoot = process.env.PROFILES_ROOT;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'profiles-routes-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempDirectory, 'profiles');
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
    restoreEnv('DATABASE_PATH', previousDatabasePath);
    restoreEnv('PROFILES_ROOT', previousProfilesRoot);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

// `json` is intentionally `any`: tests assert on the dynamic REST envelope shape.
type JsonResponse = { status: number; json: any };

async function request(
  baseUrl: string,
  pathname: string,
  init?: RequestInit,
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, json: await response.json() };
}

async function postProfile(baseUrl: string, body: unknown): Promise<JsonResponse> {
  return request(baseUrl, '/api/profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /api/profiles creates a profile and returns 201 with its fields', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await postProfile(baseUrl, { provider: 'claude', name: 'Max A' });

    assert.equal(status, 201);
    assert.equal(json.success, true);
    assert.equal(json.data.profile.provider, 'claude');
    assert.equal(json.data.profile.name, 'Max A');
    assert.equal(json.data.profile.slug, 'max-a');
    assert.ok(json.data.profile.id);
  });
});

test('POST /api/profiles rejects an invalid provider with 400', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await postProfile(baseUrl, { provider: 'gpt', name: 'X' });
    assert.equal(status, 400);
    assert.equal(json.error.code, 'INVALID_PROVIDER');
  });
});

test('POST /api/profiles rejects a missing name with 400', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await postProfile(baseUrl, { provider: 'claude', name: '   ' });
    assert.equal(status, 400);
    assert.equal(json.error.code, 'PROFILE_NAME_REQUIRED');
  });
});

test('GET /api/profiles lists profiles and filters by provider', async () => {
  await withServer(async (baseUrl) => {
    await postProfile(baseUrl, { provider: 'claude', name: 'A' });
    await postProfile(baseUrl, { provider: 'codex', name: 'B' });

    const all = await request(baseUrl, '/api/profiles');
    assert.equal(all.json.data.profiles.length, 2);

    const claudeOnly = await request(baseUrl, '/api/profiles?provider=claude');
    assert.equal(claudeOnly.json.data.profiles.length, 1);
    assert.equal(claudeOnly.json.data.profiles[0].provider, 'claude');
  });
});

test('GET /api/profiles rejects an invalid provider filter with 400', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await request(baseUrl, '/api/profiles?provider=bogus');
    assert.equal(status, 400);
    assert.equal(json.error.code, 'INVALID_PROVIDER');
  });
});

test('GET /api/profiles/:id/status reports not-authenticated for a fresh profile', async () => {
  await withServer(async (baseUrl) => {
    const created = await postProfile(baseUrl, { provider: 'claude', name: 'Fresh' });
    const id = created.json.data.profile.id;

    const { status, json } = await request(baseUrl, `/api/profiles/${id}/status`);
    assert.equal(status, 200);
    assert.equal(json.data.status.authenticated, false);
  });
});

test('GET /api/profiles/:id/status returns 404 for an unknown profile', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await request(baseUrl, '/api/profiles/nope/status');
    assert.equal(status, 404);
    assert.equal(json.error.code, 'PROFILE_NOT_FOUND');
  });
});

test('DELETE /api/profiles/:id removes a profile', async () => {
  await withServer(async (baseUrl) => {
    const created = await postProfile(baseUrl, { provider: 'claude', name: 'Temp' });
    const id = created.json.data.profile.id;

    const del = await request(baseUrl, `/api/profiles/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal(del.json.data.deleted, true);

    const list = await request(baseUrl, '/api/profiles');
    assert.equal(list.json.data.profiles.length, 0);
  });
});

test('DELETE /api/profiles/:id returns 404 for an unknown profile', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await request(baseUrl, '/api/profiles/nope', { method: 'DELETE' });
    assert.equal(status, 404);
    assert.equal(json.error.code, 'PROFILE_NOT_FOUND');
  });
});

test('DELETE /api/profiles/:id returns 409 when a live session is bound', async () => {
  await withServer(async (baseUrl) => {
    const created = await postProfile(baseUrl, { provider: 'claude', name: 'Busy' });
    const id = created.json.data.profile.id;

    sessionsDb.createAppSession('s-live', 'claude', '/workspace/demo');
    getConnection()
      .prepare('UPDATE sessions SET profile_id = ? WHERE session_id = ?')
      .run(id, 's-live');

    const { status, json } = await request(baseUrl, `/api/profiles/${id}`, { method: 'DELETE' });
    assert.equal(status, 409);
    assert.equal(json.error.code, 'PROFILE_HAS_ACTIVE_SESSIONS');
  });
});
