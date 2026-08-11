import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  closeConnection,
  initializeDatabase,
} from '@/modules/database/index.js';
import { connectedClients } from '@/modules/websocket/index.js';
import profilesRoutes from '@/modules/profiles/profiles.routes.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';
import { profileUsageService } from '@/modules/profiles/usage/profile-usage.service.js';
import type { FetchLike } from '@/modules/profiles/usage/profile-usage.types.js';
import { AppError } from '@/shared/utils.js';

/** Mirrors profiles.routes.test.ts's helper; duplicated locally so this file
 * owns its fixtures without touching the existing route test file. */
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

// Deliberately does not call `profileUsageService.clearCache()`: that also
// resets the late-result listener the router wires once at import time, which
// would defeat the wiring test below. Each test creates fresh (uuid) profile
// ids instead, so the usage cache never bleeds across tests here.
async function withServer(
  run: (baseUrl: string, profilesRoot: string) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousProfilesRoot = process.env.PROFILES_ROOT;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'profiles-usage-route-'));
  const profilesRoot = path.join(tempDirectory, 'profiles');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = profilesRoot;
  await initializeDatabase();

  const server = http.createServer(buildTestApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl, profilesRoot);
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

/**
 * Mirrors profile-usage-batch.test.ts's fixture: without a credentials file,
 * `fetchClaudeUsage` short-circuits to `unauthenticated` before ever calling
 * the deferred `fetchImpl`, so the fetch settles almost immediately and wins
 * the race against the mocked 5s deadline instead of the intended `pending`
 * path.
 */
function writeClaudeCredentials(profilesRoot: string, slug: string, expiresAt: number): void {
  const dir = path.join(profilesRoot, 'claude', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: 'token-slow', refreshToken: 'refresh-slow', expiresAt },
    }),
  );
}

// `json` is intentionally `any`: tests assert on the dynamic REST envelope shape.
type JsonResponse = { status: number; json: any };

async function request(baseUrl: string, pathname: string): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { status: response.status, json: await response.json() };
}

test('GET /api/profiles/usage returns a batch envelope array without erroring on unauthenticated profiles', async () => {
  await withServer(async (baseUrl) => {
    profilesService.createProfile({ provider: 'claude', name: 'Main' });
    profilesService.createProfile({ provider: 'codex', name: 'Side' });

    const { status, json } = await request(baseUrl, '/api/profiles/usage');

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data.usage), 'batch route must return an array, unlike the single-profile route');
    assert.equal(json.data.usage.length, 2);
    for (const envelope of json.data.usage) {
      assert.ok('profileId' in envelope);
      assert.ok('state' in envelope);
      assert.ok('snapshot' in envelope);
    }
  });
});

test('GET /api/profiles/usage is not captured by the /:id/usage route', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await request(baseUrl, '/api/profiles/usage');

    // If `/usage` were swallowed by `/:id/usage`, `parseProfileId` would treat
    // "usage" as a profile id and `getUsage` would 404 with PROFILE_NOT_FOUND.
    assert.notEqual(status, 404);
    assert.notEqual(json?.error?.code, 'PROFILE_NOT_FOUND');
    assert.ok(Array.isArray(json.data.usage));
  });
});

test('GET /api/profiles/usage orders the active profile first', async () => {
  await withServer(async (baseUrl) => {
    const first = profilesService.createProfile({ provider: 'claude', name: 'First' });
    const second = profilesService.createProfile({ provider: 'claude', name: 'Second' });

    const { status, json } = await request(baseUrl, `/api/profiles/usage?active=${second.id}`);

    assert.equal(status, 200);
    assert.equal(json.data.usage[0].profileId, second.id);
    assert.equal(json.data.usage[1].profileId, first.id);
  });
});

test('GET /api/profiles/usage?force=1 is accepted and still returns 200', async () => {
  await withServer(async (baseUrl) => {
    profilesService.createProfile({ provider: 'claude', name: 'Main' });

    const { status, json } = await request(baseUrl, '/api/profiles/usage?force=1');

    assert.equal(status, 200);
    assert.ok(Array.isArray(json.data.usage));
  });
});

test('importing the profiles router wires the late-result listener to the WS broadcast', async (t) => {
  await withServer(async (_baseUrl, profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Slow' });
    // A profile with no credentials resolves `unauthenticated` synchronously
    // and never reaches the deferred `fetchImpl` below — give it a valid
    // token so the fetch actually stays pending until `releaseFetch` fires.
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    const openMessages: string[] = [];
    const closedMessages: string[] = [];
    const openClient = { readyState: 1, send: (data: string) => openMessages.push(data) };
    const closedClient = { readyState: 3, send: (data: string) => closedMessages.push(data) };
    connectedClients.add(openClient);
    connectedClients.add(closedClient);

    // Boxed in an object because the only assignment happens inside a callback:
    // control-flow analysis would otherwise narrow a bare `let` to `null` here
    // and leave nothing callable after the assertion below.
    const pending: { release: (() => void) | null } = { release: null };
    const fetchImpl: FetchLike = () =>
      new Promise((resolve) => {
        pending.release = () =>
          resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                five_hour: { utilization: 10, resets_at: '2026-08-10T05:00:00Z' },
                seven_day: { utilization: 20, resets_at: '2026-08-11T00:00:00Z' },
                subscriptionType: 'max',
              }),
          });
      });

    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      // Drives the same past-deadline path as profile-usage.service's own
      // tests, but here to prove the module-load side effect in
      // profiles.routes.ts (`setLateResultListener(broadcastProfileUsage)`)
      // is the one actually wired — not just that the broadcast function
      // works in isolation.
      const resultPromise = profileUsageService.getAllUsage({ fetchImpl });
      t.mock.timers.tick(5_000);

      const envelopes = await resultPromise;
      assert.equal(envelopes.find((e) => e.profileId === profile.id)?.state, 'pending');

      assert.ok(pending.release, 'fetch should still be pending in the background');
      pending.release();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(openMessages.length, 1, 'the OPEN client should receive the late broadcast');
      const parsed = JSON.parse(openMessages[0]!);
      assert.equal(parsed.kind, 'profile_usage');
      assert.equal(parsed.envelope.profileId, profile.id);
      assert.equal(parsed.envelope.snapshot.status, 'ok');
      assert.equal(closedMessages.length, 0, 'a closed client must never receive the broadcast');
    } finally {
      t.mock.timers.reset();
      connectedClients.delete(openClient);
      connectedClients.delete(closedClient);
    }
  });
});
