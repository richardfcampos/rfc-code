import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionWebhookDeliveriesDb } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'webhook-deliveries-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const row = (overrides: Partial<Parameters<typeof sessionWebhookDeliveriesDb.record>[0]> = {}) => ({
  deliveryId: 'dlv_1',
  endpointId: 'james',
  userId: 1,
  event: 'session.idle',
  sessionId: 's1',
  attempt: 1,
  ok: true,
  httpStatus: 200,
  error: null,
  ...overrides,
});

test('rows list newest first with filters and a capped limit', async () => {
  await withIsolatedDatabase(() => {
    sessionWebhookDeliveriesDb.record(row({ deliveryId: 'a', ok: false, httpStatus: 500, error: 'HTTP 500' }));
    sessionWebhookDeliveriesDb.record(row({ deliveryId: 'a', attempt: 2 }));
    sessionWebhookDeliveriesDb.record(row({ deliveryId: 'b', endpointId: 'other', sessionId: 's2' }));

    assert.deepEqual(sessionWebhookDeliveriesDb.list().map((r) => r.delivery_id), ['b', 'a', 'a']);
    assert.equal(sessionWebhookDeliveriesDb.list({ endpointId: 'james' }).length, 2);
    assert.equal(sessionWebhookDeliveriesDb.list({ sessionId: 's2' }).length, 1);
    assert.equal(sessionWebhookDeliveriesDb.list({ userId: 9 }).length, 0);
    assert.equal(sessionWebhookDeliveriesDb.list({ limit: 1 }).length, 1);
    assert.equal(sessionWebhookDeliveriesDb.list({ limit: 10_000 }).length, 3);
    assert.equal(sessionWebhookDeliveriesDb.list({ endpointId: 'james', limit: 1 })[0]?.attempt, 2);
  });
});

test('an endpoint keeps only its last 500 attempts and the error text is clipped', async () => {
  await withIsolatedDatabase(() => {
    for (let i = 0; i < 505; i += 1) {
      sessionWebhookDeliveriesDb.record(row({ deliveryId: `d${i}`, error: 'x'.repeat(900), ok: false }));
    }
    sessionWebhookDeliveriesDb.record(row({ deliveryId: 'keep', endpointId: 'other' }));
    const james = sessionWebhookDeliveriesDb.list({ endpointId: 'james', limit: 200 });
    assert.equal(james.length, 200);
    assert.equal(james[0]?.delivery_id, 'd504');
    assert.equal(sessionWebhookDeliveriesDb.list({ endpointId: 'james', limit: 200 })[0]?.error?.length, 500);
    assert.equal(sessionWebhookDeliveriesDb.list({ endpointId: 'other' }).length, 1);
  });
});
