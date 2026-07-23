import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, userDb } from '../modules/database/index.js';

// auth.js reads the JWT secret from the DB at import time (see JWT_SECRET in
// auth.js), so the very first import of that module must already point at an
// isolated DB — never the real ~/.cloudcli/auth.db. A dynamic import (instead
// of a static one, which Node hoists ahead of any setup code in this file)
// lets this file set DATABASE_PATH before that first evaluation happens.
let authModule = null;

async function withIsolatedAuthEnvironment(runTest) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousAuthMode = process.env.AUTH_MODE;
  const previousContainerBind = process.env.AUTH_TRUSTED_CONTAINER_BIND;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'auth-trusted-mode-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();
  if (!authModule) {
    authModule = await import('./auth.js');
  }

  try {
    await runTest(authModule);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = previousAuthMode;
    }
    if (previousContainerBind === undefined) {
      delete process.env.AUTH_TRUSTED_CONTAINER_BIND;
    } else {
      process.env.AUTH_TRUSTED_CONTAINER_BIND = previousContainerBind;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

// --- HTTP: authenticateToken -------------------------------------------------

test('authenticateToken bypasses JWT and authenticates as the seeded user when trusted+loopback', async () => {
  await withIsolatedAuthEnvironment(async ({ authenticateToken, seedTrustedModeUser }) => {
    process.env.AUTH_MODE = 'trusted';
    await seedTrustedModeUser();

    const req = { headers: {}, query: {} };
    const res = createMockResponse();
    let nextCalled = false;
    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.user.username, 'trusted-user');
    assert.equal(res.statusCode, null);
  });
});

test('authenticateToken surfaces a clear error in trusted mode when no user exists yet', async () => {
  await withIsolatedAuthEnvironment(async ({ authenticateToken }) => {
    process.env.AUTH_MODE = 'trusted';
    // Deliberately skip seedTrustedModeUser() — the middleware itself must
    // never silently invent a user, it should surface a clear error instead.

    const req = { headers: {}, query: {} };
    const res = createMockResponse();
    let nextCalled = false;
    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /Trusted mode/);
  });
});

test('authenticateToken retrocompat: default mode still rejects a request with no token', async () => {
  await withIsolatedAuthEnvironment(async ({ authenticateToken }) => {
    // AUTH_MODE unset — default OSS behavior must be unaffected.
    const req = { headers: {}, query: {} };
    const res = createMockResponse();
    let nextCalled = false;
    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Access denied. No token provided.');
  });
});

test('authenticateToken retrocompat: default mode still accepts a valid JWT', async () => {
  await withIsolatedAuthEnvironment(async ({ authenticateToken, generateToken }) => {
    const created = userDb.createUser('regular-user', 'unused-hash');
    const user = userDb.getUserById(Number(created.id));
    const token = generateToken(user);

    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = createMockResponse();
    let nextCalled = false;
    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.user.username, 'regular-user');
  });
});

// --- WebSocket: authenticateWebSocket ----------------------------------------

test('authenticateWebSocket bypasses token validation for the seeded user when trusted', async () => {
  await withIsolatedAuthEnvironment(async ({ authenticateWebSocket, seedTrustedModeUser }) => {
    process.env.AUTH_MODE = 'trusted';
    await seedTrustedModeUser();

    const authed = authenticateWebSocket(null);

    assert.ok(authed);
    assert.equal(authed.username, 'trusted-user');
  });
});

test('authenticateWebSocket retrocompat: default mode still rejects a missing token', async () => {
  await withIsolatedAuthEnvironment(async ({ authenticateWebSocket }) => {
    assert.equal(authenticateWebSocket(null), null);
  });
});

test('authenticateWebSocket retrocompat: default mode still accepts a valid JWT', async () => {
  await withIsolatedAuthEnvironment(async ({ authenticateWebSocket, generateToken }) => {
    const created = userDb.createUser('ws-user', 'unused-hash');
    const user = userDb.getUserById(Number(created.id));
    const token = generateToken(user);

    const authed = authenticateWebSocket(token);

    assert.ok(authed);
    assert.equal(authed.username, 'ws-user');
  });
});

// --- Boot guard: assertTrustedModeBindIsSafe (HUB-01 AC2) --------------------

test('assertTrustedModeBindIsSafe refuses a public bind when trusted', async () => {
  await withIsolatedAuthEnvironment(async ({ assertTrustedModeBindIsSafe }) => {
    process.env.AUTH_MODE = 'trusted';

    for (const publicHost of ['0.0.0.0', '192.168.1.10', 'example.ts.net']) {
      assert.throws(
        () => assertTrustedModeBindIsSafe(publicHost),
        /AUTH_MODE=trusted requires HOST to be a loopback address/,
        `expected a throw for host "${publicHost}"`
      );
    }
  });
});

test('assertTrustedModeBindIsSafe allows every loopback form when trusted', async () => {
  await withIsolatedAuthEnvironment(async ({ assertTrustedModeBindIsSafe }) => {
    process.env.AUTH_MODE = 'trusted';

    for (const loopbackHost of ['127.0.0.1', '::1', 'localhost']) {
      assert.doesNotThrow(() => assertTrustedModeBindIsSafe(loopbackHost));
    }
  });
});

test('assertTrustedModeBindIsSafe accepts a non-loopback bind when the container publish contract is declared', async () => {
  await withIsolatedAuthEnvironment(async ({ assertTrustedModeBindIsSafe }) => {
    process.env.AUTH_MODE = 'trusted';
    process.env.AUTH_TRUSTED_CONTAINER_BIND = '1';

    for (const containerHost of ['0.0.0.0', '192.168.1.10', 'example.ts.net']) {
      assert.doesNotThrow(() => assertTrustedModeBindIsSafe(containerHost));
    }
  });
});

test('assertTrustedModeBindIsSafe retrocompat: still refuses a public bind when the container contract env is unset', async () => {
  await withIsolatedAuthEnvironment(async ({ assertTrustedModeBindIsSafe }) => {
    process.env.AUTH_MODE = 'trusted';
    // Deliberately not setting AUTH_TRUSTED_CONTAINER_BIND — proves the
    // default (non-containerized) protection is unchanged by this feature.

    assert.throws(
      () => assertTrustedModeBindIsSafe('0.0.0.0'),
      /AUTH_MODE=trusted requires HOST to be a loopback address/
    );
  });
});

test('assertTrustedModeBindIsSafe retrocompat: never throws outside trusted mode, even for a public bind', async () => {
  await withIsolatedAuthEnvironment(async ({ assertTrustedModeBindIsSafe }) => {
    // AUTH_MODE unset — the upstream default 0.0.0.0 bind must remain unaffected.
    assert.doesNotThrow(() => assertTrustedModeBindIsSafe('0.0.0.0'));
  });
});

// --- Auto-seed: seedTrustedModeUser ------------------------------------------

test('seedTrustedModeUser creates exactly one user when trusted and the DB is empty', async () => {
  await withIsolatedAuthEnvironment(async ({ seedTrustedModeUser }) => {
    process.env.AUTH_MODE = 'trusted';
    assert.equal(userDb.hasUsers(), false);

    await seedTrustedModeUser();

    assert.equal(userDb.hasUsers(), true);
    assert.equal(userDb.getFirstUser().username, 'trusted-user');
  });
});

test('seedTrustedModeUser is a no-op once a user already exists', async () => {
  await withIsolatedAuthEnvironment(async ({ seedTrustedModeUser }) => {
    process.env.AUTH_MODE = 'trusted';
    userDb.createUser('existing-user', 'unused-hash');

    await seedTrustedModeUser();

    assert.equal(userDb.getFirstUser().username, 'existing-user');
  });
});

test('seedTrustedModeUser retrocompat: never creates a user outside trusted mode', async () => {
  await withIsolatedAuthEnvironment(async ({ seedTrustedModeUser }) => {
    // AUTH_MODE unset — default OSS mode relies on the registration screen to
    // create the first user; auto-seeding here would silently break needsSetup.
    assert.equal(userDb.hasUsers(), false);

    await seedTrustedModeUser();

    assert.equal(userDb.hasUsers(), false);
  });
});
