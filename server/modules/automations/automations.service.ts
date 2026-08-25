/**
 * Application service for the automations engine: `server/modules/automations`.
 *
 * Owns the three guarantees the feature is judged on:
 *
 * - **idempotent**: a firing carries the identity of the event that caused it
 *   (`dedupeKey`), and an event that already has history never executes twice —
 *   guarded in memory against a concurrent second observation, and in the
 *   database against one that arrives after a restart.
 * - **retried, but bounded**: a failing action is attempted at most three times
 *   with a growing pause, then left failed. No unbounded loop ever forms.
 * - **recorded**: every attempt, successful or not, appends a row to the
 *   automation's history, so "did my rule run, and what happened" is answerable
 *   without reading a log file — except an `AutomationUnrecordedSkip`, which by
 *   construction never happened: the action recognised a guard whose cause
 *   will not still be true the next time this event is observed, and a row
 *   under this exact dedupe key would keep that guard from ever being
 *   re-checked.
 */

import type { AutomationRow, AutomationRunRow } from '@/modules/database/index.js';

import { executeAutomationAction } from './services/automation-actions.service.js';
import { AutomationNotFoundError } from './automations.errors.js';
import type {
  AutomationFireResult,
  AutomationServiceDeps,
  AutomationTriggerContext,
  AutomationView,
} from './automations.types.js';
import { parseStoredConfig, requireAutomationId } from './automations.validation.js';

/** Total attempts per firing, including the first one. */
export const MAX_ATTEMPTS = 3;

/** Pause before attempt 2 and before attempt 3. */
const BACKOFF_MS = [1_000, 3_000];

const MAX_DETAIL_LENGTH = 500;

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…` : text;
}

function readErrorMessage(error: unknown): string {
  return truncate(error instanceof Error ? error.message : String(error));
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * Strips the parts of a rule nobody outside the server may read.
 *
 * A webhook's `secretHash` is not a secret in the "would let you fire it" sense,
 * but it is offline-attackable material and no client has a use for it.
 */
export function toAutomationView(row: AutomationRow): AutomationView {
  const triggerConfig = parseStoredConfig(row.trigger_config);
  const safeTriggerConfig =
    row.trigger_kind === 'webhook'
      ? { hasSecret: typeof triggerConfig.secretHash === 'string' && triggerConfig.secretHash.length > 0 }
      : triggerConfig;

  return {
    automationId: row.automation_id,
    name: row.name,
    enabled: row.enabled === 1,
    triggerKind: row.trigger_kind,
    triggerConfig: safeTriggerConfig,
    actionKind: row.action_kind,
    actionConfig: parseStoredConfig(row.action_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AutomationFiringService {
  fire(automation: AutomationRow, context: AutomationTriggerContext): Promise<AutomationFireResult>;
  requireAutomation(id: unknown): AutomationRow;
  /** Lookup that reports "no such rule" as a value — the webhook route must not 404. */
  findAutomation(id: unknown): AutomationRow | null;
  listHistory(id: unknown, limit?: number): AutomationRunRow[];
}

/**
 * Builds the firing half of the module.
 *
 * Kept apart from the CRUD half because it is the piece every trigger source
 * shares: the scheduler, the board hook and the webhook route all end up here.
 */
export function createAutomationFiringService(deps: AutomationServiceDeps): AutomationFiringService {
  const sleep = deps.sleep ?? defaultSleep;
  /**
   * Firings in progress right now, keyed by automation and event.
   *
   * The database check below cannot see a firing that has not recorded its
   * first attempt yet, and a task can be dragged across a column twice in the
   * time one prompt takes to dispatch.
   */
  const inFlight = new Set<string>();

  function requireAutomation(rawId: unknown): AutomationRow {
    const id = requireAutomationId(rawId);
    const automation = deps.repository.get(id);
    if (!automation) {
      throw new AutomationNotFoundError(id);
    }
    return automation;
  }

  function skipped(automation: AutomationRow, detail: string): AutomationFireResult {
    return { automationId: automation.automation_id, status: 'skipped', detail, attempts: 0 };
  }

  /**
   * Appends one attempt to the history.
   *
   * A losing race on the unique dedupe index throws here; the firing has
   * already happened, so the row is dropped with a log line rather than
   * failing the caller — the winner's history already tells the story.
   */
  function record(
    automation: AutomationRow,
    context: AutomationTriggerContext,
    status: 'success' | 'failed',
    detail: string,
    attempt: number,
  ): void {
    try {
      deps.repository.runs.record({
        automationId: automation.automation_id,
        status,
        detail,
        attempt,
        dedupeKey: context.dedupeKey,
      });
    } catch (error) {
      console.error('[automations] could not record an execution attempt', {
        automationId: automation.automation_id,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function attemptAction(
    automation: AutomationRow,
    context: AutomationTriggerContext,
  ): Promise<AutomationFireResult> {
    let lastError = 'The action failed';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await executeAutomationAction(deps, automation, context);
        if (typeof outcome !== 'string') {
          // A guard whose cause is not durable (a live session already on the
          // target branch, a card that moved on before the action re-checked
          // it) must not consume the dedupe key: recording it here would
          // block that guard from ever being re-checked again, and this
          // event's next natural re-fire — the next stage change, the next
          // tick — is what deserves another look, not a retry of this
          // attempt.
          const detail = truncate(outcome.detail);
          return { automationId: automation.automation_id, status: 'skipped', detail, attempts: attempt };
        }

        const detail = truncate(outcome);
        record(automation, context, 'success', detail, attempt);
        return { automationId: automation.automation_id, status: 'success', detail, attempts: attempt };
      } catch (error) {
        lastError = readErrorMessage(error);
        record(automation, context, 'failed', lastError, attempt);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
        }
      }
    }

    return {
      automationId: automation.automation_id,
      status: 'failed',
      detail: lastError,
      attempts: MAX_ATTEMPTS,
    };
  }

  return {
    requireAutomation,

    findAutomation(rawId: unknown): AutomationRow | null {
      return typeof rawId === 'string' && rawId.trim().length > 0 ? deps.repository.get(rawId.trim()) : null;
    },

    listHistory(rawId: unknown, limit = 50): AutomationRunRow[] {
      const automation = requireAutomation(rawId);
      return deps.repository.runs.listByAutomation(automation.automation_id, limit);
    },

    async fire(automation: AutomationRow, context: AutomationTriggerContext): Promise<AutomationFireResult> {
      const key = context.dedupeKey;
      if (!key) {
        // No event identity (a manual test fire, a webhook with no idempotency
        // key): the caller asked for this exact firing, so it always runs.
        return attemptAction(automation, context);
      }

      const guard = `${automation.automation_id}::${key}`;
      if (inFlight.has(guard)) {
        return skipped(automation, 'Already firing for this event');
      }
      if (deps.repository.runs.existsForDedupeKey(automation.automation_id, key)) {
        return skipped(automation, 'Already fired for this event');
      }

      inFlight.add(guard);
      try {
        return await attemptAction(automation, context);
      } finally {
        inFlight.delete(guard);
      }
    },
  };
}
