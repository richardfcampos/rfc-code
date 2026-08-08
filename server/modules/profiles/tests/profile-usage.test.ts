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
import type { FetchLike } from '@/modules/profiles/usage/profile-usage.types.js';

/** Ephemeral DB + PROFILES_ROOT, mirroring profiles.service.test.ts. */
async function withProfilesEnvironment(
  runTest: (profilesRoot: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousProfilesRoot = process.env.PROFILES_ROOT;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'profile-usage-'));
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

function writeClaudeCredentials(profilesRoot: string, slug: string, expiresAt: number): void {
  const dir = path.join(profilesRoot, 'claude', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: 'token-123', refreshToken: 'refresh-123', expiresAt },
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

const USAGE_BODY = {
  five_hour: { utilization: 42.5, resets_at: '2026-08-08T12:00:00Z' },
  seven_day: { utilization: 80, resets_at: '2026-08-10T00:00:00Z' },
  seven_day_opus: { utilization: 130 },
  subscriptionType: 'max',
  extra_usage: 'not-a-window',
};

test('claude profile with valid credentials returns normalized windows', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    const calls: string[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push(url);
      assert.equal(init.headers.Authorization, 'Bearer token-123');
      assert.equal(init.headers['anthropic-beta'], 'oauth-2025-04-20');
      assert.match(init.headers['User-Agent'], /^claude-code\//);
      return jsonResponse(200, USAGE_BODY);
    };

    const usage = await profileUsageService.getUsage(profile.id, { fetchImpl });

    assert.equal(usage.supported, true);
    assert.equal(usage.status, 'ok');
    assert.equal(usage.plan, 'max');
    assert.deepEqual(
      usage.windows.map((w) => [w.id, w.label, w.utilization, w.resetsAt]),
      [
        ['five_hour', '5h', 42.5, '2026-08-08T12:00:00Z'],
        ['seven_day', '7d', 80, '2026-08-10T00:00:00Z'],
        ['seven_day_opus', '7d Opus', 100, null],
      ],
    );
    assert.equal(calls.length, 1);
  });
});

test('claude usage is cached within the TTL and refetched after it', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls += 1;
      return jsonResponse(200, USAGE_BODY);
    };

    let clock = Date.now();
    const now = () => new Date(clock);

    await profileUsageService.getUsage(profile.id, { fetchImpl, now });
    clock += 30_000;
    await profileUsageService.getUsage(profile.id, { fetchImpl, now });
    assert.equal(calls, 1);

    clock += 31_000;
    await profileUsageService.getUsage(profile.id, { fetchImpl, now });
    assert.equal(calls, 2);
  });
});

test('claude profile without credentials reports unauthenticated without fetching', async () => {
  await withProfilesEnvironment(async () => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });

    const fetchImpl: FetchLike = () => {
      throw new Error('must not fetch');
    };

    const usage = await profileUsageService.getUsage(profile.id, { fetchImpl });
    assert.equal(usage.status, 'unauthenticated');
    assert.deepEqual(usage.windows, []);
  });
});

test('expired token is refreshed, persisted and usage still loads', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() - 1_000);

    const fetchImpl: FetchLike = (url, init) => {
      if (url.includes('/oauth/token')) {
        const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
        assert.equal(body.grant_type, 'refresh_token');
        assert.equal(body.refresh_token, 'refresh-123');
        return jsonResponse(200, {
          access_token: 'token-new',
          refresh_token: 'refresh-new',
          expires_in: 3600,
        });
      }
      assert.equal(init.headers.Authorization, 'Bearer token-new');
      return jsonResponse(200, USAGE_BODY);
    };

    const usage = await profileUsageService.getUsage(profile.id, { fetchImpl });
    assert.equal(usage.status, 'ok');

    const persisted = JSON.parse(
      fs.readFileSync(
        path.join(profilesRoot, 'claude', profile.slug, '.credentials.json'),
        'utf8',
      ),
    ) as { claudeAiOauth: { accessToken: string; refreshToken: string; expiresAt: number } };
    assert.equal(persisted.claudeAiOauth.accessToken, 'token-new');
    assert.equal(persisted.claudeAiOauth.refreshToken, 'refresh-new');
    assert.ok(persisted.claudeAiOauth.expiresAt > Date.now());
  });
});

test('expired token with rejected refresh maps to unauthenticated', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() - 1_000);

    const usage = await profileUsageService.getUsage(profile.id, {
      fetchImpl: () => jsonResponse(400, { error: 'invalid_grant' }),
    });
    assert.equal(usage.status, 'unauthenticated');
  });
});

test('401 on usage triggers one refresh-and-retry; 5xx maps to unavailable', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Main' });
    writeClaudeCredentials(profilesRoot, profile.slug, Date.now() + 3_600_000);

    let usageCalls = 0;
    let usage = await profileUsageService.getUsage(profile.id, {
      fetchImpl: (url) => {
        if (url.includes('/oauth/token')) {
          return jsonResponse(200, { access_token: 'token-new', expires_in: 3600 });
        }
        usageCalls += 1;
        return usageCalls === 1 ? jsonResponse(401, {}) : jsonResponse(200, USAGE_BODY);
      },
    });
    assert.equal(usage.status, 'ok');
    assert.equal(usageCalls, 2);

    // The fresh 'ok' snapshot above is cached; clear it to exercise the 5xx path.
    profileUsageService.clearCache();
    usage = await profileUsageService.getUsage(profile.id, {
      fetchImpl: () => jsonResponse(500, {}),
    });
    assert.equal(usage.status, 'unavailable');

    // Failures are not cached: a later success must go through.
    usage = await profileUsageService.getUsage(profile.id, {
      fetchImpl: () => jsonResponse(200, USAGE_BODY),
    });
    assert.equal(usage.status, 'ok');
  });
});

test('codex profile reads the newest rollout rate_limits from the sessions tree', async () => {
  await withProfilesEnvironment(async (profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'codex', name: 'Work' });

    const oldDay = path.join(profilesRoot, 'codex', profile.slug, 'sessions', '2026', '08', '01');
    const newDay = path.join(profilesRoot, 'codex', profile.slug, 'sessions', '2026', '08', '07');
    fs.mkdirSync(oldDay, { recursive: true });
    fs.mkdirSync(newDay, { recursive: true });

    const staleEvent = JSON.stringify({
      timestamp: '2026-08-01T10:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: { primary: { used_percent: 99, window_minutes: 300, resets_in_seconds: 60 } },
      },
    });
    fs.writeFileSync(path.join(oldDay, 'rollout-2026-08-01T10-00-00-aaa.jsonl'), `${staleEvent}\n`);

    const freshEvent = JSON.stringify({
      timestamp: '2026-08-07T22:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          primary: { used_percent: 31.4, window_minutes: 300, resets_in_seconds: 3600 },
          secondary: { used_percent: 62, window_minutes: 10080, resets_in_seconds: 86400 },
        },
      },
    });
    fs.writeFileSync(
      path.join(newDay, 'rollout-2026-08-07T22-00-00-bbb.jsonl'),
      `{"timestamp":"2026-08-07T21:00:00.000Z","type":"other"}\n${freshEvent}\n{"broken json\n`,
    );

    const usage = await profileUsageService.getUsage(profile.id);

    assert.equal(usage.status, 'ok');
    assert.equal(usage.asOf, '2026-08-07T22:00:00.000Z');
    assert.deepEqual(
      usage.windows.map((w) => [w.id, w.label, w.utilization, w.resetsAt]),
      [
        ['primary', '5h', 31.4, '2026-08-07T23:00:00.000Z'],
        ['secondary', '7d', 62, '2026-08-08T22:00:00.000Z'],
      ],
    );
  });
});

test('codex profile without sessions reports unavailable', async () => {
  await withProfilesEnvironment(async () => {
    const profile = profilesService.createProfile({ provider: 'codex', name: 'Work' });
    const usage = await profileUsageService.getUsage(profile.id);
    assert.equal(usage.status, 'unavailable');
    assert.equal(usage.supported, true);
  });
});

test('cursor and opencode profiles report unsupported', async () => {
  await withProfilesEnvironment(async () => {
    for (const provider of ['cursor', 'opencode'] as const) {
      const profile = profilesService.createProfile({ provider, name: `Acc-${provider}` });
      const usage = await profileUsageService.getUsage(profile.id);
      assert.equal(usage.supported, false);
      assert.deepEqual(usage.windows, []);
    }
  });
});

test('unknown profile id rejects with a not-found error', async () => {
  await withProfilesEnvironment(async () => {
    await assert.rejects(
      () => profileUsageService.getUsage('no-such-profile'),
      /was not found/,
    );
  });
});
