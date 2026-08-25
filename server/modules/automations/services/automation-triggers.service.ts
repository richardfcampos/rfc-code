/**
 * The four ways an automation starts: a clock, the board, an inbound request
 * and a plan-usage reading.
 *
 * Each source's only job is to decide *whether* a rule is due and to name the
 * event that made it due — the dedupe key. Everything after that (executing,
 * retrying, recording) belongs to the firing service, so all four sources share
 * one set of guarantees instead of four subtly different ones.
 */

import type { AutomationRow, TaskRow } from '@/modules/database/index.js';

import type { AutomationFiringService } from '../automations.service.js';
import type {
  AutomationFireResult,
  AutomationServiceDeps,
  AutomationTriggerContext,
  QuotaThresholdTriggerConfig,
  TaskBacklogTriggerConfig,
  TaskStageTriggerConfig,
} from '../automations.types.js';
import { parseStoredConfig } from '../automations.validation.js';

import { baseVariables, payloadVariables, quotaVariables, taskVariables } from './automation-template.js';
import { cronMatches, cronMinuteKey, parseCronExpression } from './cron-expression.js';

const MINUTE_MS = 60_000;
const DEFAULT_QUOTA_COOLDOWN_MINUTES = 60;
const DEFAULT_BACKLOG_MAX_CONCURRENT = 2;

export interface TaskStageChange {
  task: TaskRow;
  previousStage: string | null;
}

export interface AutomationTriggerService {
  onTaskStageChanged(change: TaskStageChange): Promise<AutomationFireResult[]>;
  runTick(now?: Date): Promise<AutomationFireResult[]>;
  fireWebhook(
    automation: AutomationRow,
    payload: unknown,
    idempotencyKey: string | null,
  ): Promise<AutomationFireResult>;
  fireManually(automation: AutomationRow): Promise<AutomationFireResult>;
}

export function createAutomationTriggerService(
  deps: AutomationServiceDeps,
  firing: AutomationFiringService,
): AutomationTriggerService {
  const now = (): Date => (deps.now ? deps.now() : new Date());

  /** One rule's failure is never allowed to stop the rest of the tick. */
  async function fireSafely(
    automation: AutomationRow,
    context: AutomationTriggerContext,
  ): Promise<AutomationFireResult> {
    try {
      return await firing.fire(automation, context);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[automations] a firing threw outside its retry loop', {
        automationId: automation.automation_id,
        error: detail,
      });
      return { automationId: automation.automation_id, status: 'failed', detail, attempts: 0 };
    }
  }

  async function runCronAutomations(at: Date): Promise<AutomationFireResult[]> {
    const results: AutomationFireResult[] = [];
    const minuteKey = cronMinuteKey(at);

    for (const automation of deps.repository.listEnabledByTrigger('cron')) {
      const config = parseStoredConfig(automation.trigger_config);
      if (typeof config.cron !== 'string') continue;

      let due = false;
      try {
        due = cronMatches(parseCronExpression(config.cron), at);
      } catch (error) {
        // A stored expression can only be invalid if it was written before this
        // validation existed; complaining once a minute is the point.
        console.error('[automations] skipping a rule with an unparseable cron expression', {
          automationId: automation.automation_id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!due) continue;

      results.push(
        await fireSafely(automation, {
          // The minute is the event: a tick that runs twice inside the same
          // minute (a slow tick, a restart) must not fire the rule twice.
          dedupeKey: `cron:${minuteKey}`,
          variables: baseVariables(automation, at),
        }),
      );
    }

    return results;
  }

  async function runQuotaAutomations(at: Date): Promise<AutomationFireResult[]> {
    const results: AutomationFireResult[] = [];

    for (const automation of deps.repository.listEnabledByTrigger('quota_threshold')) {
      const config = parseStoredConfig(automation.trigger_config) as unknown as QuotaThresholdTriggerConfig;
      if (typeof config.profileId !== 'string' || typeof config.thresholdPct !== 'number') continue;

      let usagePct: number;
      try {
        const snapshot = await deps.usage.getUsage(config.profileId);
        if (!snapshot.supported || snapshot.status !== 'ok' || snapshot.windows.length === 0) {
          // No reading is not a reading of zero: a rule that fires on "quota is
          // high" must stay quiet while the number is unknown.
          continue;
        }
        usagePct = Math.max(...snapshot.windows.map((window) => window.utilization));
      } catch (error) {
        console.error('[automations] could not read plan usage for a quota rule', {
          automationId: automation.automation_id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (usagePct < config.thresholdPct) continue;

      // Usage stays above the threshold for as long as the window lasts, so the
      // cooldown bucket — not the crossing — is the event: the rule fires once
      // per bucket instead of once per tick for the rest of the day.
      const cooldown = config.cooldownMinutes ?? DEFAULT_QUOTA_COOLDOWN_MINUTES;
      const bucket = Math.floor(at.getTime() / (cooldown * MINUTE_MS));

      results.push(
        await fireSafely(automation, {
          dedupeKey: `quota:${config.profileId}:${bucket}`,
          variables: {
            ...baseVariables(automation, at),
            ...quotaVariables(config.profileId, usagePct, config.thresholdPct),
          },
        }),
      );
    }

    return results;
  }

  /**
   * Re-wakes at most one finished plan per enabled `task_backlog` rule per
   * tick: a parent that decomposed, is still `in_progress`, and whose every
   * subtask has reached `done`.
   *
   * Deliberately **not** gated by `maxConcurrent`. The moment a parent's last
   * child reaches `done`, `countActiveInProgress` stops excluding it — it is
   * once again a task with no unfinished children, so it counts against the
   * ceiling exactly like a fresh pickup would. Gating integration on that same
   * ceiling would let the parent's own slot block the integration that frees
   * it: at `maxConcurrent: 1` that is a guaranteed deadlock. Do not add the
   * gate back.
   */
  async function runParentIntegrations(at: Date): Promise<AutomationFireResult[]> {
    const results: AutomationFireResult[] = [];

    for (const automation of deps.repository.listEnabledByTrigger('task_backlog')) {
      const config = parseStoredConfig(automation.trigger_config) as unknown as TaskBacklogTriggerConfig;
      if (typeof config.project !== 'string' || config.project.trim().length === 0) continue;

      let elected: TaskRow | undefined;
      let dedupeKey = '';
      for (const parent of deps.board.listParentsAwaitingIntegration(config.project)) {
        const children = deps.board.listSubtasks(parent.id);
        // The fingerprint of "this exact completed set": unchanged while
        // nothing changes (fires once), bumped by a reopen-and-refinish (the
        // reopened child's updated_at moves) or by a plan that grew a child
        // (childCount changes) — so the rule fires again exactly when the plan
        // actually has new work to integrate.
        const newest = children.reduce(
          (latest, child) => (child.updated_at > latest ? child.updated_at : latest),
          '',
        );
        const key = `integrate:${parent.id}:${children.length}:${newest}`;
        if (!deps.repository.runs.existsForDedupeKey(automation.automation_id, key)) {
          elected = parent;
          dedupeKey = key;
          break;
        }
      }
      if (!elected) continue;

      results.push(
        await fireSafely(automation, {
          dedupeKey,
          variables: { ...baseVariables(automation, at), ...taskVariables(elected, null) },
          task: elected,
          intent: 'integrate',
        }),
      );
    }

    return results;
  }

  /**
   * Drains at most one ready ticket per enabled `task_backlog` rule per tick.
   *
   * The concurrency gate runs before election so a project already at its
   * ceiling never even reads the candidate list. Among ready candidates
   * (oldest first, already the query's order) the first one *without* run
   * history for its current identity is taken — not blindly the head — so a
   * ticket whose pickup already exhausted its retries cannot sit at the front
   * of the queue forever and starve every ticket behind it.
   */
  async function runBacklogAutomations(at: Date): Promise<AutomationFireResult[]> {
    const results: AutomationFireResult[] = [];

    for (const automation of deps.repository.listEnabledByTrigger('task_backlog')) {
      const config = parseStoredConfig(automation.trigger_config) as unknown as TaskBacklogTriggerConfig;
      if (typeof config.project !== 'string' || config.project.trim().length === 0) continue;

      const maxConcurrent =
        typeof config.maxConcurrent === 'number' ? config.maxConcurrent : DEFAULT_BACKLOG_MAX_CONCURRENT;
      if (deps.board.countActiveInProgress(config.project) >= maxConcurrent) continue;

      let elected: TaskRow | undefined;
      let dedupeKey = '';
      for (const candidate of deps.board.listReadyBacklog(config.project)) {
        const key = `backlog:${candidate.id}:${candidate.updated_at}`;
        if (!deps.repository.runs.existsForDedupeKey(automation.automation_id, key)) {
          elected = candidate;
          dedupeKey = key;
          break;
        }
      }
      if (!elected) continue;

      results.push(
        await fireSafely(automation, {
          dedupeKey,
          variables: { ...baseVariables(automation, at), ...taskVariables(elected, null) },
          task: elected,
        }),
      );
    }

    return results;
  }

  return {
    async onTaskStageChanged(change: TaskStageChange): Promise<AutomationFireResult[]> {
      const results: AutomationFireResult[] = [];
      const at = now();

      for (const automation of deps.repository.listEnabledByTrigger('task_stage')) {
        const config = parseStoredConfig(automation.trigger_config) as unknown as TaskStageTriggerConfig;
        if (config.toStage !== change.task.stage) continue;
        if (config.fromStage && config.fromStage !== change.previousStage) continue;
        if (config.project && config.project !== change.task.project_name) continue;

        results.push(
          await fireSafely(automation, {
            // The transition is the event, so a card dragged back and forth
            // between two columns does not re-prompt an agent every time.
            dedupeKey: `task:${change.task.id}:stage:${change.task.stage}`,
            variables: {
              ...baseVariables(automation, at),
              ...taskVariables(change.task, change.previousStage),
            },
            task: change.task,
          }),
        );
      }

      return results;
    },

    async runTick(at: Date = now()): Promise<AutomationFireResult[]> {
      const cron = await runCronAutomations(at);
      const quota = await runQuotaAutomations(at);
      // Integrations run before the backlog election so a finished plan is
      // never starved by a tick that spent its election on a fresh ticket.
      const integrations = await runParentIntegrations(at);
      const backlog = await runBacklogAutomations(at);
      return [...cron, ...quota, ...integrations, ...backlog];
    },

    fireWebhook(automation, payload, idempotencyKey) {
      const at = now();
      return fireSafely(automation, {
        // Senders that repeat a delivery identify it; senders that do not get a
        // firing per call, which is the only honest reading of "no id".
        dedupeKey: idempotencyKey ? `webhook:${idempotencyKey}` : null,
        variables: {
          ...baseVariables(automation, at),
          ...payloadVariables(payload),
        },
      });
    },

    fireManually(automation) {
      const at = now();
      return firing.fire(automation, {
        dedupeKey: null,
        variables: { ...baseVariables(automation, at), 'trigger.manual': 'true' },
      });
    },
  };
}
