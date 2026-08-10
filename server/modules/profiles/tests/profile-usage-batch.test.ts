import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
} from '@/modules/database/index.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';
import { profileUsageService } from '@/modules/profiles/usage/profile-usage.service.js';
import type { FetchLike, ProfileUsageEnvelope } from '@/modules/profiles/usage/profile-usage.types.js';

/** Ephemeral DB + PROFILES_ROOT, mirroring profile-usage.test.ts. */
async function withProfilesEnvironment(
  runTest: (profilesRoot: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousProfilesRoot = process.env.PROFILES_ROOT;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'profile-usage-batch-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const profilesRoot = path.join(tempDirectory, 'profiles');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.PROFILES_ROOT = profilesRoot;
  await initializeDatabase();
  profileUsageService.clearCache();

  try {
    await runTest(profilesRoot);
  } finally {
    profileUsageService.clearCache();
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

function writeClaudeCredentials(
  profilesRoot: string,
  slug: string,
  expiresAt: number,
  accessToken = 'token-123',
): void {
  const dir = path.join(profilesRoot, 'claude', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken, refreshToken: 'refresh-123', expiresAt },
    }),
  );
}

function jsonResponse(status: number, body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

function jsonResponseWithHeaders(
  status: number,
  body: unknown,
  headers: Record<string, string>,
): ReturnType<FetchLike> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  });
}

const USAGE_BODY = {
  five_hour: { utilization: 42.5, resets_at: '2026-08-08T12:00:00Z' },
  seven_day: { utilization: 80, resets_at: '2026-08-10T00:00:00Z' },
  subscriptionType: 'max',
};

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('two concurrent getAllUsage calls fetch each profile once', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const claude = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, claude.slug, Date.now() + 3_600_000);
    const codex = profilesService.createProfile({ provider: 'codex', name: 'Work' });

    let claudeCalls = 0;
    const fetchImpl: FetchLike = () => {
      claudeCalls += 1;
      return jsonResponse(200, USAGE_BODY);
    };

    const [batchA, batchB] = await Promise.all([
      profileUsageService.getAllUsage({ fetchImpl }),
      profileUsageService.getAllUsage({ fetchImpl }),
    ]);

    assert.equal(claudeCalls, 1);
    assert.equal(batchA.length, 2);
    assert.equal(batchB.length, 2);

    const claudeEnvelope = batchA.find((e) => e.profileId === claude.id);
    assert.equal(claudeEnvelope?.state, 'cached');
    assert.equal(claudeEnvelope?.snapshot?.status, 'ok');

    const codexEnvelope = batchB.find((e) => e.profileId === codex.id);
    assert.equal(codexEnvelope?.state, 'cached');
    assert.equal(codexEnvelope?.snapshot?.status, 'unavailable');
  });
});

test('a concurrent getAllUsage and getUsage call for the same profile share one fetch', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const claude = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, claude.slug, Date.now() + 3_600_000);

    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      return jsonResponse(200, USAGE_BODY);
    };

    const [batch, single] = await Promise.all([
      profileUsageService.getAllUsage({ fetchImpl }),
      profileUsageService.getUsage(claude.id, { fetchImpl }),
    ]);

    assert.equal(calls, 1);
    assert.equal(single.status, 'ok');
    assert.equal(batch.find((e) => e.profileId === claude.id)?.snapshot?.status, 'ok');
  });
});

test('caps in-flight fetches at 4 even with 5 profiles pending', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    for (let i = 0; i < 5; i += 1) {
      const profile = profilesService.createProfile({ provider: 'claude', name: `Acc-${i}` });
      writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000, `token-${i}`);
    }

    let active = 0;
    let callCount = 0;
    const pendingReleases: Array<() => void> = [];
    const fetchImpl: FetchLike = () => {
      active += 1;
      callCount += 1;
      assert.ok(active <= 4, `active in-flight fetches exceeded 4: ${active}`);
      return new Promise((resolve) => {
        pendingReleases.push(() => {
          active -= 1;
          resolve({ ok: true, status: 200, json: () => Promise.resolve(USAGE_BODY) });
        });
      });
    };

    const resultPromise = profileUsageService.getAllUsage({ fetchImpl });

    await flush();
    await flush();
    assert.equal(callCount, 4, 'only 4 fetches should start immediately');

    // Release two of the first four; the remaining candidate should now start.
    pendingReleases.shift()!();
    pendingReleases.shift()!();
    await flush();
    await flush();
    assert.equal(callCount, 5, 'the 5th fetch should start once a slot frees up');

    while (pendingReleases.length > 0) {
      pendingReleases.shift()!();
    }

    const envelopes = await resultPromise;
    assert.equal(envelopes.length, 5);
    assert.ok(envelopes.every((e) => e.state === 'cached' && e.snapshot?.status === 'ok'));
  });
});

test('an unauthenticated profile does not crash the batch or enter the negative cache, unlike a real failure', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const loggedOut = profilesService.createProfile({ provider: 'claude', name: 'LoggedOut' });
    const failing = profilesService.createProfile({ provider: 'claude', name: 'Failing' });
    writeClaudeCredentials(profilesRoot, failing.slug, Date.now() + 3_600_000, 'token-failing');
    const healthy = profilesService.createProfile({ provider: 'claude', name: 'Healthy' });
    writeClaudeCredentials(profilesRoot, healthy.slug, Date.now() + 3_600_000, 'token-healthy');

    const fetchImpl: FetchLike = (_url, init) => {
      if (init.headers.Authorization === 'Bearer token-failing') {
        return jsonResponse(500, {});
      }
      return jsonResponse(200, USAGE_BODY);
    };

    const first = await profileUsageService.getAllUsage({ fetchImpl });
    assert.equal(first.length, 3);
    assert.equal(first.find((e) => e.profileId === loggedOut.id)?.snapshot?.status, 'unauthenticated');
    assert.equal(first.find((e) => e.profileId === failing.id)?.snapshot?.status, 'unavailable');
    assert.equal(first.find((e) => e.profileId === healthy.id)?.snapshot?.status, 'ok');

    // Immediately after: the failing profile should be held by its negative
    // cache (no new fetch), but the logged-out one must retry right away.
    writeClaudeCredentials(profilesRoot, loggedOut.slug, Date.now() + 3_600_000, 'token-logged-out-now');
    let secondCallReachedFailing = false;
    const secondFetchImpl: FetchLike = (_url, init) => {
      if (init.headers.Authorization === 'Bearer token-failing') {
        secondCallReachedFailing = true;
      }
      return jsonResponse(200, USAGE_BODY);
    };

    const second = await profileUsageService.getAllUsage({ fetchImpl: secondFetchImpl });
    assert.equal(
      second.find((e) => e.profileId === loggedOut.id)?.snapshot?.status,
      'ok',
      'a freshly logged-in profile must not be held back by any cache',
    );
    assert.equal(
      second.find((e) => e.profileId === failing.id)?.snapshot?.status,
      'unavailable',
      'the negative cache should still be serving the prior failure',
    );
    assert.equal(secondCallReachedFailing, false, 'the negative-cached profile must not be re-fetched yet');
  });
});

test('a fetch exceeding the render deadline returns pending and reports the late result', async (t) => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Slow' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    let releaseFetch: (() => void) | null = null;
    const fetchImpl: FetchLike = () =>
      new Promise((resolve) => {
        releaseFetch = () =>
          resolve({ ok: true, status: 200, json: () => Promise.resolve(USAGE_BODY) });
      });

    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const resultPromise = profileUsageService.getAllUsage({ fetchImpl });
      t.mock.timers.tick(5_000);

      const envelopes = await resultPromise;
      assert.equal(envelopes.length, 1);
      assert.equal(envelopes[0]?.state, 'pending');
      assert.equal(envelopes[0]?.snapshot, null);

      let lateEnvelope: ProfileUsageEnvelope | null = null;
      profileUsageService.setLateResultListener((envelope) => {
        lateEnvelope = envelope;
      });

      assert.ok(releaseFetch, 'fetch should still be pending in the background');
      releaseFetch!();
      await flush();
      await flush();

      assert.ok(lateEnvelope, 'the late-result listener should fire once the fetch resolves');
      const settled = lateEnvelope as unknown as ProfileUsageEnvelope;
      assert.equal(settled.state, 'cached');
      assert.equal(settled.profileId, profile.id);
      assert.equal(settled.snapshot?.status, 'ok');
    } finally {
      profileUsageService.setLateResultListener(null);
      t.mock.timers.reset();
    }
  });
});

test('rate_limited negative cache respects retryAfterMs and expires on schedule', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    let clock = Date.now();
    const now = () => new Date(clock);
    let calls = 0;
    const rateLimitedFetch: FetchLike = () => {
      calls += 1;
      return jsonResponseWithHeaders(429, {}, { 'retry-after': '10' });
    };

    let [envelope] = await profileUsageService.getAllUsage({ fetchImpl: rateLimitedFetch, now });
    assert.equal(envelope?.snapshot?.status, 'unavailable');
    assert.equal(envelope?.snapshot?.reason, 'rate_limited');
    assert.equal(envelope?.retryAt, new Date(clock + 10_000).toISOString());
    assert.equal(calls, 1);

    clock += 9_000;
    [envelope] = await profileUsageService.getAllUsage({ fetchImpl: rateLimitedFetch, now });
    assert.equal(envelope?.state, 'cached');
    assert.equal(calls, 1, 'still within the retryAfterMs cooldown');

    clock += 2_000; // 11s elapsed, past the 10s retryAfterMs
    const successFetch: FetchLike = () => {
      calls += 1;
      return jsonResponse(200, USAGE_BODY);
    };
    [envelope] = await profileUsageService.getAllUsage({ fetchImpl: successFetch, now });
    assert.equal(envelope?.snapshot?.status, 'ok');
    assert.equal(calls, 2);
  });
});

test('network failure negative cache defaults to a 15s cooldown', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    let clock = Date.now();
    const now = () => new Date(clock);
    let calls = 0;
    const failingFetch: FetchLike = () => {
      calls += 1;
      return Promise.reject(new Error('ECONNRESET'));
    };

    let [envelope] = await profileUsageService.getAllUsage({ fetchImpl: failingFetch, now });
    assert.equal(envelope?.snapshot?.status, 'unavailable');
    assert.equal(envelope?.snapshot?.reason, 'network');
    assert.equal(envelope?.retryAt, undefined, 'only rate_limited exposes a retryAt');
    assert.equal(calls, 1);

    clock += 14_000;
    [envelope] = await profileUsageService.getAllUsage({ fetchImpl: failingFetch, now });
    assert.equal(calls, 1, 'still within the default 15s cooldown');

    clock += 2_000; // 16s elapsed
    const successFetch: FetchLike = () => jsonResponse(200, USAGE_BODY);
    [envelope] = await profileUsageService.getAllUsage({ fetchImpl: successFetch, now });
    assert.equal(envelope?.snapshot?.status, 'ok');
  });
});

test('force skips fetching during a rate_limited lockout but returns the retryAt', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    const clock = Date.now();
    const now = () => new Date(clock);

    await profileUsageService.getAllUsage({
      fetchImpl: () => jsonResponseWithHeaders(429, {}, { 'retry-after': '30' }),
      now,
    });

    const forcedFetch: FetchLike = () => {
      throw new Error('must not fetch during a rate_limited lockout');
    };
    const [envelope] = await profileUsageService.getAllUsage({
      fetchImpl: forcedFetch,
      now,
      force: true,
    });

    assert.equal(envelope?.state, 'cached');
    assert.equal(envelope?.snapshot?.status, 'unavailable');
    assert.equal(envelope?.snapshot?.reason, 'rate_limited');
    assert.equal(envelope?.retryAt, new Date(clock + 30_000).toISOString());
  });
});

test('force fetches outside of a rate_limited lockout and throttles to one fetch per 5s', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    let clock = Date.now();
    const now = () => new Date(clock);
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      return jsonResponse(200, USAGE_BODY);
    };

    // Seed a fresh TTL cache entry; force must ignore it and fetch anyway.
    await profileUsageService.getAllUsage({ fetchImpl, now });
    assert.equal(calls, 1);

    const [forced] = await profileUsageService.getAllUsage({ fetchImpl, now, force: true });
    assert.equal(calls, 2, 'force ignores the TTL cache');
    assert.equal(forced?.snapshot?.status, 'ok');

    // A second force within 5s of the first forced fetch must not re-fetch.
    clock += 1_000;
    const [throttled] = await profileUsageService.getAllUsage({ fetchImpl, now, force: true });
    assert.equal(calls, 2, 'two forces within 5s should collapse to one fetch');
    assert.equal(throttled?.state, 'cached');
    assert.equal(throttled?.snapshot?.status, 'ok');

    // Past the 5s throttle window, force fetches again.
    clock += 5_000;
    await profileUsageService.getAllUsage({ fetchImpl, now, force: true });
    assert.equal(calls, 3);
  });
});
