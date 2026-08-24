import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { automationsDb } from '@/modules/database/repositories/automations.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'automations-db-'));
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

function createCronAutomation(name = 'Nightly sweep') {
  return automationsDb.create({
    name,
    triggerKind: 'cron',
    triggerConfig: JSON.stringify({ cron: '0 3 * * *' }),
    actionKind: 'create_task',
    actionConfig: JSON.stringify({ project: 'my-app', title: 'Sweep' }),
  });
}

test('create stores the rule enabled by default and returns the full row', async () => {
  await withIsolatedDatabase(() => {
    const automation = createCronAutomation();

    assert.ok(automation.automation_id);
    assert.equal(automation.name, 'Nightly sweep');
    assert.equal(automation.enabled, 1);
    assert.equal(automation.trigger_kind, 'cron');
    assert.equal(automation.action_kind, 'create_task');
    assert.deepEqual(JSON.parse(automation.trigger_config), { cron: '0 3 * * *' });
  });
});

test('create honours an explicit disabled flag', async () => {
  await withIsolatedDatabase(() => {
    const automation = automationsDb.create({
      name: 'Paused',
      enabled: false,
      triggerKind: 'webhook',
      triggerConfig: '{}',
      actionKind: 'notify_push',
      actionConfig: JSON.stringify({ message: 'hi' }),
    });

    assert.equal(automation.enabled, 0);
  });
});

test('listEnabledByTrigger filters by kind and skips disabled rules', async () => {
  await withIsolatedDatabase(() => {
    createCronAutomation('Cron A');
    const disabled = createCronAutomation('Cron B');
    automationsDb.update(disabled.automation_id, { enabled: false });
    automationsDb.create({
      name: 'Hook',
      triggerKind: 'webhook',
      triggerConfig: '{}',
      actionKind: 'notify_push',
      actionConfig: '{}',
    });

    const cronRules = automationsDb.listEnabledByTrigger('cron');
    assert.equal(cronRules.length, 1);
    assert.equal(cronRules[0].name, 'Cron A');

    assert.equal(automationsDb.listEnabledByTrigger('webhook').length, 1);
    assert.equal(automationsDb.listEnabledByTrigger('task_stage').length, 0);
  });
});

test('update writes only the given fields and bumps updated_at', async () => {
  await withIsolatedDatabase(() => {
    const automation = createCronAutomation();
    getConnection()
      .prepare("UPDATE automations SET updated_at = '2000-01-01 00:00:00' WHERE automation_id = ?")
      .run(automation.automation_id);

    const updated = automationsDb.update(automation.automation_id, {
      name: 'Renamed',
      triggerConfig: JSON.stringify({ cron: '*/5 * * * *' }),
    });

    assert.ok(updated);
    assert.equal(updated.name, 'Renamed');
    assert.equal(updated.action_kind, 'create_task');
    assert.deepEqual(JSON.parse(updated.trigger_config), { cron: '*/5 * * * *' });
    assert.notEqual(updated.updated_at, '2000-01-01 00:00:00');
  });
});

test('update with no fields is a no-op read and unknown ids return null', async () => {
  await withIsolatedDatabase(() => {
    const automation = createCronAutomation();

    assert.equal(automationsDb.update(automation.automation_id, {})?.name, 'Nightly sweep');
    assert.equal(automationsDb.update('missing', { name: 'x' }), null);
    assert.equal(automationsDb.get('missing'), null);
    assert.equal(automationsDb.delete('missing'), false);
  });
});

test('deleting an automation cascades its execution history away', async () => {
  await withIsolatedDatabase(() => {
    const automation = createCronAutomation();
    automationsDb.runs.record({ automationId: automation.automation_id, status: 'success' });

    assert.equal(automationsDb.delete(automation.automation_id), true);
    assert.equal(automationsDb.runs.listByAutomation(automation.automation_id).length, 0);
  });
});

test('run history is returned newest first and honours the limit', async () => {
  await withIsolatedDatabase(() => {
    const automation = createCronAutomation();
    automationsDb.runs.record({ automationId: automation.automation_id, status: 'success', detail: 'first' });
    automationsDb.runs.record({ automationId: automation.automation_id, status: 'failed', detail: 'second' });
    automationsDb.runs.record({ automationId: automation.automation_id, status: 'skipped', detail: 'third' });

    const all = automationsDb.runs.listByAutomation(automation.automation_id);
    assert.deepEqual(all.map((run) => run.detail), ['third', 'second', 'first']);
    assert.equal(all[0].attempt, 1);

    assert.equal(automationsDb.runs.listByAutomation(automation.automation_id, 2).length, 2);
  });
});

test('a dedupe key is observable once recorded, per automation', async () => {
  await withIsolatedDatabase(() => {
    const first = createCronAutomation('First');
    const second = createCronAutomation('Second');

    automationsDb.runs.record({
      automationId: first.automation_id,
      status: 'success',
      dedupeKey: 'task:task-1:stage:in_progress',
    });

    assert.equal(automationsDb.runs.existsForDedupeKey(first.automation_id, 'task:task-1:stage:in_progress'), true);
    assert.equal(automationsDb.runs.existsForDedupeKey(first.automation_id, 'task:task-2:stage:in_progress'), false);
    assert.equal(automationsDb.runs.existsForDedupeKey(second.automation_id, 'task:task-1:stage:in_progress'), false);
  });
});

test('the same dedupe key and attempt cannot be recorded twice', async () => {
  await withIsolatedDatabase(() => {
    const automation = createCronAutomation();
    const record = (attempt: number) =>
      automationsDb.runs.record({
        automationId: automation.automation_id,
        status: 'failed',
        attempt,
        dedupeKey: 'cron:2026-08-24T03:00',
      });

    record(1);
    // Later attempts of the same firing share the key and are kept apart by
    // their attempt number, so a retry sequence is a readable history.
    record(2);
    assert.throws(() => record(2), /UNIQUE constraint failed/);
  });
});

test('rows without a dedupe key never collide', async () => {
  await withIsolatedDatabase(() => {
    const automation = createCronAutomation();
    automationsDb.runs.record({ automationId: automation.automation_id, status: 'success' });
    automationsDb.runs.record({ automationId: automation.automation_id, status: 'success' });

    assert.equal(automationsDb.runs.listByAutomation(automation.automation_id).length, 2);
  });
});
