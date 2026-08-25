/**
 * Persistence for the automations engine: rules and their execution history.
 *
 * Trigger/action parameters are stored as JSON text and handed back as raw
 * strings — parsing and validating them is the automations module's business,
 * not this layer's.
 */

import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type AutomationTriggerKind = 'cron' | 'task_stage' | 'webhook' | 'quota_threshold' | 'task_backlog';
export type AutomationActionKind = 'prompt_agent' | 'create_task' | 'notify_push' | 'pickup_task';
export type AutomationRunStatus = 'success' | 'failed' | 'skipped';

export type AutomationRow = {
  automation_id: string;
  name: string;
  enabled: number;
  trigger_kind: AutomationTriggerKind;
  trigger_config: string;
  action_kind: AutomationActionKind;
  action_config: string;
  created_at: string;
  updated_at: string;
};

export type AutomationRunRow = {
  run_id: string;
  automation_id: string;
  fired_at: string;
  status: AutomationRunStatus;
  detail: string | null;
  attempt: number;
  dedupe_key: string | null;
};

export type CreateAutomationInput = {
  name: string;
  enabled?: boolean;
  triggerKind: AutomationTriggerKind;
  triggerConfig: string;
  actionKind: AutomationActionKind;
  actionConfig: string;
};

export type UpdateAutomationInput = {
  name?: string;
  enabled?: boolean;
  triggerKind?: AutomationTriggerKind;
  triggerConfig?: string;
  actionKind?: AutomationActionKind;
  actionConfig?: string;
};

export type RecordAutomationRunInput = {
  automationId: string;
  status: AutomationRunStatus;
  detail?: string | null;
  attempt?: number;
  dedupeKey?: string | null;
};

const AUTOMATION_COLUMNS =
  'automation_id, name, enabled, trigger_kind, trigger_config, action_kind, action_config, created_at, updated_at';

const RUN_COLUMNS = 'run_id, automation_id, fired_at, status, detail, attempt, dedupe_key';

function getAutomationById(automationId: string): AutomationRow | null {
  const db = getConnection();
  const row = db
    .prepare(`SELECT ${AUTOMATION_COLUMNS} FROM automations WHERE automation_id = ?`)
    .get(automationId) as AutomationRow | undefined;
  return row ?? null;
}

export const automationsDb = {
  create(input: CreateAutomationInput): AutomationRow {
    const db = getConnection();
    const automationId = randomUUID();
    db.prepare(
      `INSERT INTO automations (
         automation_id, name, enabled, trigger_kind, trigger_config, action_kind, action_config
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      automationId,
      input.name,
      input.enabled === false ? 0 : 1,
      input.triggerKind,
      input.triggerConfig,
      input.actionKind,
      input.actionConfig,
    );
    return getAutomationById(automationId) as AutomationRow;
  },

  get(automationId: string): AutomationRow | null {
    return getAutomationById(automationId);
  },

  list(): AutomationRow[] {
    const db = getConnection();
    return db
      .prepare(`SELECT ${AUTOMATION_COLUMNS} FROM automations ORDER BY datetime(created_at) DESC, rowid DESC`)
      .all() as AutomationRow[];
  },

  /** Enabled automations of one trigger kind — what the scheduler and the task hook walk. */
  listEnabledByTrigger(triggerKind: AutomationTriggerKind): AutomationRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${AUTOMATION_COLUMNS} FROM automations
         WHERE trigger_kind = ? AND enabled = 1
         ORDER BY datetime(created_at) ASC, rowid ASC`,
      )
      .all(triggerKind) as AutomationRow[];
  },

  /** Partial update; only the keys present in `fields` are written. Always bumps `updated_at`. */
  update(automationId: string, fields: UpdateAutomationInput): AutomationRow | null {
    const db = getConnection();
    const assignments: string[] = [];
    const values: (string | number)[] = [];

    if (fields.name !== undefined) {
      assignments.push('name = ?');
      values.push(fields.name);
    }
    if (fields.enabled !== undefined) {
      assignments.push('enabled = ?');
      values.push(fields.enabled ? 1 : 0);
    }
    if (fields.triggerKind !== undefined) {
      assignments.push('trigger_kind = ?');
      values.push(fields.triggerKind);
    }
    if (fields.triggerConfig !== undefined) {
      assignments.push('trigger_config = ?');
      values.push(fields.triggerConfig);
    }
    if (fields.actionKind !== undefined) {
      assignments.push('action_kind = ?');
      values.push(fields.actionKind);
    }
    if (fields.actionConfig !== undefined) {
      assignments.push('action_config = ?');
      values.push(fields.actionConfig);
    }

    if (assignments.length === 0) {
      return getAutomationById(automationId);
    }

    assignments.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE automations SET ${assignments.join(', ')} WHERE automation_id = ?`).run(
      ...values,
      automationId,
    );
    return getAutomationById(automationId);
  },

  delete(automationId: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM automations WHERE automation_id = ?').run(automationId).changes > 0;
  },

  runs: {
    /**
     * Appends one attempt to an automation's history.
     *
     * Throws on a duplicate `(automation_id, dedupe_key, attempt)`: the unique
     * index is the idempotency guarantee, and a caller that races another
     * firing has to hear about it rather than record a second execution.
     */
    record(input: RecordAutomationRunInput): AutomationRunRow {
      const db = getConnection();
      const runId = randomUUID();
      db.prepare(
        `INSERT INTO automation_runs (run_id, automation_id, status, detail, attempt, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        runId,
        input.automationId,
        input.status,
        input.detail ?? null,
        input.attempt ?? 1,
        input.dedupeKey ?? null,
      );
      return db.prepare(`SELECT ${RUN_COLUMNS} FROM automation_runs WHERE run_id = ?`).get(runId) as AutomationRunRow;
    },

    /** Newest first; the history view is always read most-recent-first. */
    listByAutomation(automationId: string, limit = 50): AutomationRunRow[] {
      const db = getConnection();
      return db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM automation_runs
           WHERE automation_id = ?
           ORDER BY datetime(fired_at) DESC, rowid DESC
           LIMIT ?`,
        )
        .all(automationId, limit) as AutomationRunRow[];
    },

    /**
     * True when this automation already fired for this event.
     *
     * Any recorded attempt counts, including a failed one: a firing that
     * exhausted its retries must not come back the next time the same event is
     * observed (a board refresh, a second webhook delivery of the same id).
     */
    existsForDedupeKey(automationId: string, dedupeKey: string): boolean {
      const db = getConnection();
      const row = db
        .prepare('SELECT 1 AS hit FROM automation_runs WHERE automation_id = ? AND dedupe_key = ? LIMIT 1')
        .get(automationId, dedupeKey) as { hit: number } | undefined;
      return row !== undefined;
    },
  },
};
