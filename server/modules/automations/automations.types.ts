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

/** Drains a project's backlog on the minute tick. */
export interface TaskBacklogTriggerConfig {
  /** The board's project id, matched against `TaskRow.project_name`. Required. */
  project: string;
  /** Ceiling on concurrently running tickets in the project. Integer 1–10, defaults to 2. */
  maxConcurrent: number;
}

export type AutomationTriggerConfig =
  | CronTriggerConfig
  | TaskStageTriggerConfig
  | WebhookTriggerConfig
  | QuotaThresholdTriggerConfig
  | TaskBacklogTriggerConfig;

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
  /**
   * Run in the worktree of the task that triggered the rule, rather than in
   * `projectPath`. One rule serves every task on a board, so the worktree
   * cannot be named in config — it is whatever the firing task is checked out
   * in. Ignored when the firing carries no task, or the task has no branch.
   */
  useTaskWorktree?: boolean;
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

export interface PickupTaskActionConfig {
  /** Repository the worktree is cut from; also what the org policy resolves against. */
  projectPath: string;
  provider?: LLMProvider;
  /** Optional explicit account. Still checked against the org allow-list. */
  profileId?: string;
  /** Base for the ticket's new branch; defaults to the main worktree's branch. */
  baseBranch?: string;
}

export type AutomationActionConfig =
  | PromptAgentActionConfig
  | CreateTaskActionConfig
  | NotifyPushActionConfig
  | PickupTaskActionConfig;

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
  /**
   * Which half of the backlog loop a `pickup_task` firing is.
   *
   * Absent (the default) means "claim a ready ticket". `integrate` means the
   * elected task is a decomposed parent whose subtasks are all done and whose
   * card must not be claimed again — the two paths meet the same task row in
   * two different stages, so the intent cannot be inferred from the row.
   */
  intent?: 'pickup' | 'integrate';
}

/**
 * A skip whose cause is not durable: a live session already on the target
 * branch, a card that moved on before the action re-checked it. The same
 * guard can look identical the next time the same event is observed, so an
 * action returns this instead of a plain detail string to tell the firing
 * service the attempt must leave no run row behind — a row under this
 * event's dedupe key would block the guard from ever being re-checked, and
 * the event's next natural re-fire (the next stage change, the next tick) is
 * what gives it another chance, not a retry of this attempt.
 */
export interface AutomationUnrecordedSkip {
  readonly unrecorded: true;
  readonly detail: string;
}

/** Builds the one skip shape every action uses for a guard that must not burn its dedupe key. */
export function unrecordedSkip(detail: string): AutomationUnrecordedSkip {
  return { unrecorded: true, detail };
}

/** What one action attempt actually produces: a detail to record, or a skip that must not be. */
export type AutomationActionResult = string | AutomationUnrecordedSkip;

export interface PromptAgentInput {
  projectPath: string;
  provider: LLMProvider;
  prompt: string;
  requestedProfileId: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  /**
   * False marks a run dispatched to work alongside a branch rather than to
   * continue that branch's own authorship — a `prompt_agent` rule invited to
   * look at a ticket already being (or already) worked, for instance.
   * Defaults to true: a `pickup_task` claim and its later integration are
   * both the ticket's own authorship continuing. Threaded through to the
   * spawned session's row so a later reader can tell the two apart without
   * guessing from recency — see `AUXILIARY_SESSION_DISPLAY_NAME`.
   */
  isAuthoringRun?: boolean;
}

export interface PromptAgentResult {
  sessionId: string;
  /** The account the org policy settled on; null means the provider default. */
  profileId: string | null;
}

/** Spawns a server-initiated run. Resolves once the run is dispatched, not when it finishes. */
export interface AutomationAgentGateway {
  promptAgent(input: PromptAgentInput): Promise<PromptAgentResult>;
  /**
   * True when a chat run is currently live on a session tied to this
   * worktree branch. Checked before dispatch so a pickup never joins a
   * second agent to a branch that already has one working — a task's own
   * `worktree_branch` says the branch existed, not that anything is
   * currently attached to it, which is why this reads the run registry
   * rather than the task.
   */
  hasLiveSessionForBranch(branch: string): boolean;
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

/** The board, as election and pickup need it. */
export interface AutomationBoardGateway {
  /** Backlog tasks in the project whose dependencies are all done, oldest first. */
  listReadyBacklog(project: string): TaskRow[];
  /**
   * Tasks in the project that occupy a concurrency slot right now.
   *
   * A parent that decomposed sits in `in_progress` with no agent attached: its
   * subtasks are the work, and counting the parent as well would let one
   * decomposition eat the ceiling and, at `maxConcurrent: 1`, deadlock its own
   * children. A parent whose children are all done counts again — it is about
   * to be handed back an agent for the integration.
   */
  countActiveInProgress(project: string): number;
  /**
   * Decomposed parents ready to be integrated: still `in_progress`, at least
   * one subtask, and every subtask `done`. Oldest first.
   */
  listParentsAwaitingIntegration(project: string): TaskRow[];
  /** A parent's subtasks in plan order — the branches an integration merges. */
  listSubtasks(parentTaskId: string): TaskRow[];
  /**
   * The parent ticket of a subtask, or null for a top-level one. A separate
   * read because `TaskRow` does not carry `parent_task_id`.
   */
  getParentTask(taskId: string): TaskRow | null;
  /**
   * The tasks this one depends on, whatever their stage — their branches carry
   * work it has to build on. Unlike `listBlockers`, done ones are included:
   * by the time a task is elected its blockers are all done, and those are
   * exactly the branches that matter.
   */
  listUpstreamTasks(taskId: string): TaskRow[];
  /** Re-reads a task; null when it no longer exists. Used for the claim re-check. */
  getTask(taskId: string): TaskRow | null;
  /**
   * Moves a card to `in_progress` and stamps its branch in one write, then
   * broadcasts — but only when the card's current stage still matches
   * `expectedStage` (compare-and-swap). Worktree creation takes long enough
   * for a person to drag the card elsewhere in the meantime, and a blind
   * write would yank it back; this returns null (no write, no broadcast)
   * instead, so the caller can treat it as the same clean abort as any other
   * lost claim.
   */
  moveToInProgress(taskId: string, worktreeBranch: string, expectedStage: TaskStage): Promise<TaskRow | null>;
  /**
   * Best-effort revert to `backlog`, used when a dispatch fails after the
   * card left backlog for this pickup attempt — whether this attempt moved it
   * or a prior attempt did. Errors are the caller's to swallow and log: this
   * must never mask the dispatch failure it is cleaning up after.
   */
  revertToBacklog(taskId: string): Promise<void>;
}

/** Creating the isolation a ticket is worked in. */
export interface AutomationWorktreeGateway {
  /**
   * Returns the worktree for `branch`, creating it when it does not exist yet.
   * Reuse rather than create is what makes a retried pickup safe.
   */
  ensureWorktree(input: {
    projectPath: string;
    branch: string;
    baseBranch?: string | null;
  }): Promise<{ worktreePath: string; branch: string }>;
}

export interface AutomationServiceDeps {
  repository: AutomationRepositoryGateway;
  agent: AutomationAgentGateway;
  tasks: AutomationTasksGateway;
  notify: AutomationNotifyGateway;
  usage: AutomationUsageGateway;
  board: AutomationBoardGateway;
  worktrees: AutomationWorktreeGateway;
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
