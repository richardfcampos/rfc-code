/**
 * Test doubles for the Automations ports.
 *
 * The repository is a working in-memory implementation rather than a stub —
 * idempotency is a property of what the history already contains, so a test
 * about it needs a store that remembers, including the unique-key rule the real
 * index enforces.
 */

import { randomUUID } from 'node:crypto';

import type { AutomationRow, AutomationRunRow, TaskRow } from '@/modules/database/index.js';

import type {
  AutomationBoardGateway,
  AutomationRepositoryGateway,
  AutomationServiceDeps,
  AutomationWorktreeGateway,
  PromptAgentInput,
} from '../../automations.types.js';

export const TASK: TaskRow = {
  id: 'task-1',
  project_name: 'my-app',
  title: 'Ship the board',
  description: 'A card an agent should pick up',
  stage: 'in_progress',
  origin: 'user',
  origin_detail: null,
  assignee_profile_id: null,
  suggested_skill: null,
  worktree_branch: null,
  created_at: '2026-08-24T00:00:00.000Z',
  updated_at: '2026-08-24T00:00:00.000Z',
};

export interface FakeRepository extends AutomationRepositoryGateway {
  rows: AutomationRow[];
  history: AutomationRunRow[];
  seed(overrides?: Partial<AutomationRow>): AutomationRow;
}

export function createFakeRepository(): FakeRepository {
  const rows: AutomationRow[] = [];
  const history: AutomationRunRow[] = [];

  return {
    rows,
    history,

    seed(overrides: Partial<AutomationRow> = {}): AutomationRow {
      const row: AutomationRow = {
        automation_id: overrides.automation_id ?? randomUUID(),
        name: 'Rule',
        enabled: 1,
        trigger_kind: 'task_stage',
        trigger_config: JSON.stringify({ toStage: 'in_progress' }),
        action_kind: 'notify_push',
        action_config: JSON.stringify({ message: 'Moved: {{task}}' }),
        created_at: '2026-08-24T00:00:00.000Z',
        updated_at: '2026-08-24T00:00:00.000Z',
        ...overrides,
      };
      rows.push(row);
      return row;
    },

    get: (automationId) => rows.find((row) => row.automation_id === automationId) ?? null,
    list: () => [...rows],
    listEnabledByTrigger: (kind) => rows.filter((row) => row.trigger_kind === kind && row.enabled === 1),

    create(input) {
      const row: AutomationRow = {
        automation_id: randomUUID(),
        name: input.name,
        enabled: input.enabled === false ? 0 : 1,
        trigger_kind: input.triggerKind,
        trigger_config: input.triggerConfig,
        action_kind: input.actionKind,
        action_config: input.actionConfig,
        created_at: '2026-08-24T00:00:00.000Z',
        updated_at: '2026-08-24T00:00:00.000Z',
      };
      rows.push(row);
      return row;
    },

    update(automationId, fields) {
      const row = rows.find((candidate) => candidate.automation_id === automationId);
      if (!row) return null;

      if (fields.name !== undefined) row.name = fields.name;
      if (fields.enabled !== undefined) row.enabled = fields.enabled ? 1 : 0;
      if (fields.triggerKind !== undefined) row.trigger_kind = fields.triggerKind;
      if (fields.triggerConfig !== undefined) row.trigger_config = fields.triggerConfig;
      if (fields.actionKind !== undefined) row.action_kind = fields.actionKind;
      if (fields.actionConfig !== undefined) row.action_config = fields.actionConfig;
      row.updated_at = new Date().toISOString();
      return row;
    },

    delete(automationId) {
      const index = rows.findIndex((row) => row.automation_id === automationId);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },

    runs: {
      record(input) {
        const duplicate =
          input.dedupeKey != null &&
          history.some(
            (run) =>
              run.automation_id === input.automationId &&
              run.dedupe_key === input.dedupeKey &&
              run.attempt === (input.attempt ?? 1),
          );
        if (duplicate) {
          throw new Error('UNIQUE constraint failed: automation_runs.dedupe_key');
        }

        const run: AutomationRunRow = {
          run_id: randomUUID(),
          automation_id: input.automationId,
          fired_at: new Date().toISOString(),
          status: input.status,
          detail: input.detail ?? null,
          attempt: input.attempt ?? 1,
          dedupe_key: input.dedupeKey ?? null,
        };
        history.push(run);
        return run;
      },

      listByAutomation: (automationId, limit = 50) =>
        history.filter((run) => run.automation_id === automationId).reverse().slice(0, limit),

      existsForDedupeKey: (automationId, dedupeKey) =>
        history.some((run) => run.automation_id === automationId && run.dedupe_key === dedupeKey),
    },
  };
}

/**
 * A backlog task seeded for election, with its blockers and parent named by id.
 *
 * `dependsOn` and `parentTaskId` are fake-board bookkeeping only — the real
 * board resolves both through the `task_dependencies` table and the
 * `parent_task_id` column, not a field on `TaskRow`.
 */
export type FakeBoardTaskSeed = Partial<TaskRow> & { dependsOn?: string[]; parentTaskId?: string };

export interface FakeBoard extends AutomationBoardGateway {
  tasks: TaskRow[];
  moved: { taskId: string; worktreeBranch: string }[];
  reverted: string[];
  seed(overrides?: FakeBoardTaskSeed): TaskRow;
}

/** In-memory board a test seeds with backlog tickets (and their dependency edges) before electing. */
export function createFakeBoard(): FakeBoard {
  const tasks: TaskRow[] = [];
  const dependencies = new Map<string, string[]>();
  const parents = new Map<string, string>();
  const moved: { taskId: string; worktreeBranch: string }[] = [];
  const reverted: string[] = [];

  const children = (parentId: string): TaskRow[] =>
    tasks
      .filter((task) => parents.get(task.id) === parentId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return {
    tasks,
    moved,
    reverted,

    seed(overrides: FakeBoardTaskSeed = {}): TaskRow {
      const { dependsOn, parentTaskId, ...taskOverrides } = overrides;
      const task: TaskRow = {
        id: randomUUID(),
        project_name: 'my-app',
        title: 'Backlog ticket',
        description: null,
        stage: 'backlog',
        origin: 'user',
        origin_detail: null,
        assignee_profile_id: null,
        suggested_skill: null,
        worktree_branch: null,
        created_at: '2026-08-24T00:00:00.000Z',
        updated_at: '2026-08-24T00:00:00.000Z',
        ...taskOverrides,
      };
      tasks.push(task);
      if (dependsOn) dependencies.set(task.id, dependsOn);
      if (parentTaskId) parents.set(task.id, parentTaskId);
      return task;
    },

    listReadyBacklog(project) {
      return tasks
        .filter((task) => task.project_name === project && task.stage === 'backlog')
        .filter((task) =>
          (dependencies.get(task.id) ?? []).every(
            (blockerId) => tasks.find((blocker) => blocker.id === blockerId)?.stage === 'done',
          ),
        )
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    },

    // Mirrors the SQL: an in-progress task with no child that is not `done`
    // counts, whether that means "no children at all" or "every child done".
    countActiveInProgress(project) {
      return tasks.filter(
        (task) =>
          task.project_name === project &&
          task.stage === 'in_progress' &&
          children(task.id).every((child) => child.stage === 'done'),
      ).length;
    },

    listParentsAwaitingIntegration(project) {
      return tasks
        .filter((task) => {
          if (task.project_name !== project || task.stage !== 'in_progress') return false;
          const kids = children(task.id);
          return kids.length > 0 && kids.every((child) => child.stage === 'done');
        })
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    },

    listSubtasks(parentTaskId) {
      return children(parentTaskId);
    },

    getParentTask(taskId) {
      const parentId = parents.get(taskId);
      return parentId ? (tasks.find((task) => task.id === parentId) ?? null) : null;
    },

    listUpstreamTasks(taskId) {
      return (dependencies.get(taskId) ?? [])
        .map((upstreamId) => tasks.find((task) => task.id === upstreamId))
        .filter((task): task is TaskRow => task !== undefined)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    },

    getTask(taskId) {
      return tasks.find((task) => task.id === taskId) ?? null;
    },

    async moveToInProgress(taskId, worktreeBranch, expectedStage) {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error(`fake board: no task ${taskId}`);
      }
      if (task.stage !== expectedStage) {
        return null;
      }
      task.stage = 'in_progress';
      task.worktree_branch = worktreeBranch;
      task.updated_at = new Date().toISOString();
      moved.push({ taskId, worktreeBranch });
      return task;
    },

    async revertToBacklog(taskId) {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error(`fake board: no task ${taskId}`);
      }
      task.stage = 'backlog';
      task.updated_at = new Date().toISOString();
      reverted.push(taskId);
    },
  };
}

export interface FakeWorktrees extends AutomationWorktreeGateway {
  ensured: { projectPath: string; branch: string; baseBranch?: string | null }[];
}

/** Every branch reuses the same deterministic path — reuse-vs-create is not this fake's concern. */
export function createFakeWorktrees(): FakeWorktrees {
  const ensured: { projectPath: string; branch: string; baseBranch?: string | null }[] = [];

  return {
    ensured,
    async ensureWorktree(input) {
      ensured.push(input);
      return { worktreePath: `/worktrees/${input.branch}`, branch: input.branch };
    },
  };
}

export interface FakeAutomationDeps extends AutomationServiceDeps {
  repository: FakeRepository;
  board: FakeBoard;
  worktrees: FakeWorktrees;
  prompts: PromptAgentInput[];
  createdTasks: Record<string, unknown>[];
  pushes: { userId?: number; message: string; automationName: string }[];
  sleeps: number[];
}

/** Every collaborator succeeds by default; a test overrides only what it is about. */
export function createFakeDeps(overrides: Partial<AutomationServiceDeps> = {}): FakeAutomationDeps {
  const repository = (overrides.repository as FakeRepository) ?? createFakeRepository();
  const board = (overrides.board as FakeBoard) ?? createFakeBoard();
  const worktrees = (overrides.worktrees as FakeWorktrees) ?? createFakeWorktrees();
  const prompts: PromptAgentInput[] = [];
  const createdTasks: Record<string, unknown>[] = [];
  const pushes: { userId?: number; message: string; automationName: string }[] = [];
  const sleeps: number[] = [];

  return {
    repository,
    board,
    worktrees,
    prompts,
    createdTasks,
    pushes,
    sleeps,
    agent: overrides.agent ?? {
      promptAgent: async (input) => {
        prompts.push(input);
        return { sessionId: 'session-1', profileId: 'profile-a' };
      },
      // No branch has a live session by default; tests about the duplicate-
      // agent guard override this explicitly.
      hasLiveSessionForBranch: () => false,
    },
    tasks: overrides.tasks ?? {
      createTask: async (body) => {
        createdTasks.push(body);
        return { ...TASK, id: 'task-created', title: String(body.title ?? TASK.title) };
      },
    },
    notify: overrides.notify ?? {
      push: (input) => {
        pushes.push(input);
      },
    },
    usage: overrides.usage ?? {
      getUsage: async () => ({ supported: true, status: 'ok', windows: [{ utilization: 10 }] }),
    },
    // Retries must not cost the suite real seconds; the delays are asserted instead.
    sleep:
      overrides.sleep ??
      (async (milliseconds) => {
        sleeps.push(milliseconds);
      }),
    now: overrides.now,
  };
}
