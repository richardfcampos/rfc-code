/**
 * Contracts for the Automations module.
 *
 * Everything the engine touches to fire an automation — the task board, the
 * policy engine, the provider spawn path, push notifications, plan usage and
 * even the clock — arrives as a narrow port. Firing rules is the part with the
 * interesting behaviour (idempotency, retries, history), and it has to be
 * testable without a database, a model account or a real minute passing.
 */

import type {
  AutomationRow,
  AutomationRunRow,
  AutomationRunStatus,
  CreateAutomationInput,
  TaskRow,
  TaskStage,
  UpdateAutomationInput,
} from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

export type { AutomationRow, AutomationRunRow, AutomationRunStatus };

/** Cron expressions are matched at minute granularity, in the server's local time. */
export interface CronTriggerConfig {
  cron: string;
}

export interface TaskStageTriggerConfig {
  /** Fires when a task lands on this stage. */
  toStage: TaskStage;
  /** Optional: only when the task came from this stage. */
  fromStage?: TaskStage;
  /** Optional: only for tasks of this project (the board's project id). */
  project?: string;
}

/**
 * The shared secret is stored hashed, never in the clear: the plaintext is
 * shown once at creation/rotation and is the caller's to keep.
 */
export interface WebhookTriggerConfig {
  secretHash: string;
}

export interface QuotaThresholdTriggerConfig {
  profileId: string;
  /** Fires once usage of any plan window reaches this percentage. */
  thresholdPct: number;
  /** Minimum gap between two firings while usage stays above the threshold. Defaults to 60. */
  cooldownMinutes?: number;
}

export type AutomationTriggerConfig =
  | CronTriggerConfig
  | TaskStageTriggerConfig
  | WebhookTriggerConfig
  | QuotaThresholdTriggerConfig;

export interface PromptAgentActionConfig {
  /** Repository the agent runs in; also what the org policy is resolved against. */
  projectPath: string;
  provider?: LLMProvider;
  /** Supports `{{...}}` placeholders filled from the trigger context. */
  promptTemplate: string;
  /**
   * Optional explicit account. Still checked against the org allow-list — an
   * automation may narrow the resolver's choice, never bypass it.
   */
  profileId?: string;
  /** Skill the prompt asks the agent to load, appended as a hint line. */
  skill?: string;
  /** Pins the run to a worktree instead of the repository root. */
  worktreePath?: string;
  worktreeBranch?: string;
}

export interface CreateTaskActionConfig {
  project: string;
  /** Supports `{{...}}` placeholders. */
  title: string;
  description?: string;
  suggestedSkill?: string;
  assigneeProfileId?: string;
}

export interface NotifyPushActionConfig {
  /** Supports `{{...}}` placeholders. */
  message: string;
  /** Defaults to the installation's first active user. */
  userId?: number;
}

export type AutomationActionConfig =
  | PromptAgentActionConfig
  | CreateTaskActionConfig
  | NotifyPushActionConfig;

/** An automation as the REST surface returns it: parsed, and free of secrets. */
export interface AutomationView {
  automationId: string;
  name: string;
  enabled: boolean;
  triggerKind: AutomationRow['trigger_kind'];
  triggerConfig: Record<string, unknown>;
  actionKind: AutomationRow['action_kind'];
  actionConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Why an automation fired, and the values its templates interpolate.
 *
 * `dedupeKey` is the identity of the event: two firings carrying the same key
 * are the same event observed twice, and only the first one executes. A null
 * key means "always fire" (manual test fires, webhooks with no idempotency key).
 */
export interface AutomationTriggerContext {
  dedupeKey: string | null;
  /** Flat `{{name}}` → value map handed to the template interpolator. */
  variables: Record<string, string>;
  /** Present for task-stage firings; lets an action reference the task itself. */
  task?: TaskRow;
}

export interface PromptAgentInput {
  projectPath: string;
  provider: LLMProvider;
  prompt: string;
  requestedProfileId: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
}

export interface PromptAgentResult {
  sessionId: string;
  /** The account the org policy settled on; null means the provider default. */
  profileId: string | null;
}

/** Spawns a server-initiated run. Resolves once the run is dispatched, not when it finishes. */
export interface AutomationAgentGateway {
  promptAgent(input: PromptAgentInput): Promise<PromptAgentResult>;
}

export interface AutomationTasksGateway {
  createTask(body: Record<string, unknown>): Promise<TaskRow>;
}

export interface AutomationNotifyGateway {
  push(input: { userId?: number; message: string; automationName: string }): void;
}

export interface AutomationUsageGateway {
  getUsage(profileId: string): Promise<{ windows: { utilization: number }[]; status: string; supported: boolean }>;
}

export interface AutomationRepositoryGateway {
  get(automationId: string): AutomationRow | null;
  list(): AutomationRow[];
  listEnabledByTrigger(kind: AutomationRow['trigger_kind']): AutomationRow[];
  create(input: CreateAutomationInput): AutomationRow;
  update(automationId: string, fields: UpdateAutomationInput): AutomationRow | null;
  delete(automationId: string): boolean;
  runs: {
    record(input: {
      automationId: string;
      status: AutomationRunStatus;
      detail?: string | null;
      attempt?: number;
      dedupeKey?: string | null;
    }): AutomationRunRow;
    listByAutomation(automationId: string, limit?: number): AutomationRunRow[];
    existsForDedupeKey(automationId: string, dedupeKey: string): boolean;
  };
}

export interface AutomationServiceDeps {
  repository: AutomationRepositoryGateway;
  agent: AutomationAgentGateway;
  tasks: AutomationTasksGateway;
  notify: AutomationNotifyGateway;
  usage: AutomationUsageGateway;
  /** Overridable so retry tests do not spend real seconds sleeping. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Overridable clock, so cron and cooldown windows are testable. */
  now?: () => Date;
}

/** One recorded firing, as the REST surface and the scheduler report it. */
export interface AutomationFireResult {
  automationId: string;
  status: AutomationRunStatus;
  detail: string;
  attempts: number;
}
