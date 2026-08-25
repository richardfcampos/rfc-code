/**
 * Upgrade-path tests for the `automations` table's `trigger_kind`/`action_kind`
 * CHECK lists.
 *
 * `CREATE TABLE IF NOT EXISTS` means a fresh install always gets the widened
 * CHECK straight from the schema file, so what needs proving here is the other
 * half: an installation that already has the narrow CHECK gains the wider one
 * without losing a rule or its execution history, and re-running the migration
 * is a no-op.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'automations-kind-migration-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

/** Replaces the migrated `automations` table with the pre-widening (narrow CHECK) shape, keeping one seeded rule. */
function seedLegacyAutomationsTable(): void {
  const db = getConnection();
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('DROP TABLE automation_runs');
  db.exec('DROP TABLE automations');
  db.exec(`
    CREATE TABLE automations (
      automation_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger_kind TEXT NOT NULL
        CHECK (trigger_kind IN ('cron', 'task_stage', 'webhook', 'quota_threshold')),
      trigger_config TEXT NOT NULL DEFAULT '{}',
      action_kind TEXT NOT NULL
        CHECK (action_kind IN ('prompt_agent', 'create_task', 'notify_push')),
      action_config TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE automation_runs (
      run_id TEXT PRIMARY KEY NOT NULL,
      automation_id TEXT NOT NULL,
      fired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
      detail TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      dedupe_key TEXT,
      FOREIGN KEY (automation_id) REFERENCES automations(automation_id) ON DELETE CASCADE
    )
  `);
  db.prepare(
    `INSERT INTO automations (automation_id, name, trigger_kind, trigger_config, action_kind, action_config)
     VALUES ('rule-legacy', 'Nightly sweep', 'cron', '{"cron":"0 3 * * *"}', 'notify_push', '{"message":"hi"}')`,
  ).run();
  db.prepare(
    `INSERT INTO automation_runs (run_id, automation_id, status, attempt, dedupe_key)
     VALUES ('run-legacy', 'rule-legacy', 'success', 1, 'cron:2026-08-24T03:00')`,
  ).run();
  db.exec('PRAGMA foreign_keys = ON');
}

test('an installation with the narrow CHECK gains task_backlog/pickup_task support', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    seedLegacyAutomationsTable();

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO automations (automation_id, name, trigger_kind, action_kind)
             VALUES ('rule-rejected', 'Rejected', 'task_backlog', 'pickup_task')`,
          )
          .run(),
      /CHECK constraint failed/,
    );

    runMigrations(db);

    db.prepare(
      `INSERT INTO automations (automation_id, name, trigger_kind, trigger_config, action_kind, action_config)
       VALUES ('rule-backlog', 'Drain the backlog', 'task_backlog', '{"project":"my-app","maxConcurrent":2}', 'pickup_task', '{"projectPath":"/p"}')`,
    ).run();

    const backlogRule = db
      .prepare('SELECT trigger_kind, action_kind FROM automations WHERE automation_id = ?')
      .get('rule-backlog') as { trigger_kind: string; action_kind: string };
    assert.equal(backlogRule.trigger_kind, 'task_backlog');
    assert.equal(backlogRule.action_kind, 'pickup_task');

    const survivingRule = db
      .prepare('SELECT name, trigger_kind FROM automations WHERE automation_id = ?')
      .get('rule-legacy') as { name: string; trigger_kind: string };
    assert.equal(survivingRule.name, 'Nightly sweep');
    assert.equal(survivingRule.trigger_kind, 'cron');

    const survivingRun = db
      .prepare('SELECT automation_id, status FROM automation_runs WHERE run_id = ?')
      .get('run-legacy') as { automation_id: string; status: string };
    assert.equal(survivingRun.automation_id, 'rule-legacy');
    assert.equal(survivingRun.status, 'success');
  });
});

test('running the migration twice does not duplicate rows or error', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    seedLegacyAutomationsTable();

    runMigrations(db);
    runMigrations(db);

    const ruleCount = (db.prepare('SELECT COUNT(*) AS count FROM automations').get() as { count: number }).count;
    assert.equal(ruleCount, 1);

    const runCount = (db.prepare('SELECT COUNT(*) AS count FROM automation_runs').get() as { count: number }).count;
    assert.equal(runCount, 1);

    const tableSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'automations'")
      .get() as { sql: string };
    assert.match(tableSql.sql, /task_backlog/);
  });
});

test('a fresh database already accepts task_backlog and pickup_task', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    db.prepare(
      `INSERT INTO automations (automation_id, name, trigger_kind, action_kind)
       VALUES ('rule-fresh', 'Fresh', 'task_backlog', 'pickup_task')`,
    ).run();

    const row = db.prepare('SELECT trigger_kind FROM automations WHERE automation_id = ?').get('rule-fresh') as {
      trigger_kind: string;
    };
    assert.equal(row.trigger_kind, 'task_backlog');
  });
});
