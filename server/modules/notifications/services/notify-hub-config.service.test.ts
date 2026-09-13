import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appConfigDb, closeConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  getNotifyHubConfig,
  saveNotifyHubConfig,
  sendNotifyHubTest,
  toNotifyHubPublicView,
} from '@/modules/notifications/services/notify-hub-config.service.js';

// Config reads hit a real sqlite connection, so tests need an isolated DB file
// the same way the repository tests do (see session-legs.db.test.ts).
async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'notify-hub-config-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
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

async function withEnv(vars: Record<string, string | undefined>, run: () => void | Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      restoreEnv(key, value);
    }
  }
}

test('DB value overrides env for the same field', async () => {
  await withIsolatedDatabase(async () => {
    await withEnv({ NOTIFY_URL: 'http://env.example.com', NOTIFY_TOKEN: 'env-token' }, () => {
      appConfigDb.set('notify_hub_url', 'https://db.example.com');

      const cfg = getNotifyHubConfig();

      assert.equal(cfg.url, 'https://db.example.com');
      assert.equal(cfg.token, 'env-token');
      assert.equal(cfg.source, 'db');
    });
  });
});

test('falls back to env per field when DB has no value', async () => {
  await withIsolatedDatabase(async () => {
    await withEnv(
      { NOTIFY_URL: 'http://env.example.com', NOTIFY_TOKEN: 'env-token', NOTIFY_TIMEZONE: 'America/Sao_Paulo' },
      () => {
        const cfg = getNotifyHubConfig();

        assert.equal(cfg.url, 'http://env.example.com');
        assert.equal(cfg.token, 'env-token');
        assert.equal(cfg.timezone, 'America/Sao_Paulo');
        assert.equal(cfg.source, 'env');
      }
    );
  });
});

test('no DB value and no env resolves to source "none"', async () => {
  await withIsolatedDatabase(async () => {
    await withEnv({ NOTIFY_URL: undefined, NOTIFY_TOKEN: undefined, NOTIFY_TIMEZONE: undefined }, () => {
      const cfg = getNotifyHubConfig();

      assert.equal(cfg.url, null);
      assert.equal(cfg.token, null);
      assert.equal(cfg.source, 'none');
    });
  });
});

test('saving with an empty token keeps the existing stored token', async () => {
  await withIsolatedDatabase(async () => {
    await withEnv({ NOTIFY_URL: undefined, NOTIFY_TOKEN: undefined }, () => {
      saveNotifyHubConfig({ url: 'https://hub.example.com', token: 'first-token' });

      const updated = saveNotifyHubConfig({ url: 'https://hub2.example.com', token: '' });

      assert.equal(updated.url, 'https://hub2.example.com');
      assert.equal(updated.token, 'first-token');
    });
  });
});

test('rejects an invalid URL with a 400 AppError', async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => saveNotifyHubConfig({ url: 'not-a-url', token: 'tok' }),
      (error: any) => error.statusCode === 400
    );

    assert.throws(
      () => saveNotifyHubConfig({ url: 'ftp://hub.example.com', token: 'tok' }),
      (error: any) => error.statusCode === 400
    );
  });
});

test('rejects an invalid IANA timezone with a 400 AppError', async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => saveNotifyHubConfig({ url: 'https://hub.example.com', token: 'tok', timezone: 'Not/A_Zone' }),
      (error: any) => error.statusCode === 400
    );
  });
});

test('public view masks the token and exposes only the last 4 chars as a hint', async () => {
  await withIsolatedDatabase(() => {
    const cfg = saveNotifyHubConfig({ url: 'https://hub.example.com', token: 'super-secret-abcd' });
    const view = toNotifyHubPublicView(cfg);

    assert.equal(view.hasToken, true);
    assert.equal(view.tokenHint, '••••abcd');
    assert.equal(view.configured, true);
    assert.equal((view as any).token, undefined);
    assert.doesNotMatch(JSON.stringify(view), /super-secret-abcd/);
  });
});

test('sendNotifyHubTest resolves ok on a 202 response', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };

  try {
    const cfg = { url: `http://127.0.0.1:${port}`, token: 'tok', timezone: null, source: 'db' as const };
    const result = await sendNotifyHubTest(cfg, { title: 't' });

    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('sendNotifyHubTest maps 401 to "Token inválido"', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };

  try {
    const cfg = { url: `http://127.0.0.1:${port}`, token: 'bad-tok', timezone: null, source: 'db' as const };
    const result = await sendNotifyHubTest(cfg, { title: 't' });

    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.error, 'Token inválido');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('sendNotifyHubTest resolves ok=false without throwing when the host is unreachable', async () => {
  // Port 1 is privileged/unbound: the connection is refused promptly.
  const cfg = { url: 'http://127.0.0.1:1', token: 'tok', timezone: null, source: 'db' as const };

  const result = await sendNotifyHubTest(cfg, { title: 't' });

  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.ok(result.error);
});
