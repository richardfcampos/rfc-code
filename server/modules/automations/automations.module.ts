/**
 * Composition root of the Automations module.
 *
 * The only file that binds the engine to real storage, the real task board, the
 * real policy engine, the real push channel and the real provider runtimes.
 * Everything below it is a function of injected ports, which is what lets the
 * interesting parts — idempotency, retries, trigger evaluation — be tested
 * without a database, a socket or a model account.
 *
 * Provider spawn functions are configured by the server entrypoint rather than
 * imported: they live in `server/claude-sdk.js` and friends, outside the module
 * boundaries the backend lint rules enforce. Same seam, same reason, as
 * `configureCollabClaudeRuntime`.
 */

import { access } from 'node:fs/promises';

import { describeAgentBridgeRegistrationForSession } from '@/modules/agent-bridge/index.js';
import { automationsDb, sessionsDb, taskDependenciesDb, tasksDb, userDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { orgPolicyService } from '@/modules/orgs/index.js';
import { profileUsageService } from '@/modules/profiles/index.js';
import { broadcastTaskUpdate, registerTaskStageListener, tasksService } from '@/modules/tasks/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { createWorktree, listWorktreePorcelainEntries } from '@/modules/worktrees/index.js';
import { runGitCommand } from '@/shared/git-command.js';

import { createAutomationAdminService } from './services/automation-admin.service.js';
import {
  createAutomationSpawnGateway,
  type AutomationSpawnDeps,
  type ProviderSpawnFn,
} from './services/automation-agent-spawn.service.js';
import { createAutomationScheduler } from './services/automation-scheduler.service.js';
import { createAutomationTriggerService } from './services/automation-triggers.service.js';
import { createAutomationsRouter, createAutomationWebhookRouter } from './automations.routes.js';
import { createAutomationFiringService } from './automations.service.js';
import type { AutomationAgentGateway, AutomationServiceDeps } from './automations.types.js';

/**
 * Provider runtimes, filled in at boot.
 *
 * Empty until the entrypoint configures them, and a `prompt_agent` action that
 * fires before then fails loudly (and is retried) rather than quietly doing
 * nothing.
 */
let spawnFns: AutomationSpawnDeps['spawnFns'] = {};

export function configureAutomationRuntimes(fns: Partial<Record<string, ProviderSpawnFn>>): void {
  spawnFns = fns as AutomationSpawnDeps['spawnFns'];
}

const spawnGateway = createAutomationSpawnGateway({
  policy: orgPolicyService,
  registry: chatRunRegistry,
  createSession: ({ sessionId, provider, projectPath, profileId, worktreePath, worktreeBranch, customName }) => {
    sessionsDb.createAppSession(sessionId, provider, projectPath, profileId, worktreePath, worktreeBranch, customName);
  },
  bridge: { describeRegistrationForSession: describeAgentBridgeRegistrationForSession },
  // Read through a getter so the entrypoint can configure the runtimes after
  // this module graph has already been imported.
  get spawnFns() {
    return spawnFns;
  },
});

const agent: AutomationAgentGateway = {
  promptAgent: (input) => spawnGateway.promptAgent(input),
  // A session, not a task, is what a live agent is attached to — a task's own
  // `worktree_branch` survives long after the agent that set it exits. Read
  // every session pinned to the branch and ask the run registry (the single
  // in-memory source of truth for "something is running") whether any of them
  // is still live.
  hasLiveSessionForBranch: (branch) =>
    sessionsDb
      .getAllSessions()
      .some((session) => session.worktree_branch === branch && chatRunRegistry.isProcessing(session.session_id)),
};

const deps: AutomationServiceDeps = {
  repository: automationsDb,
  agent,
  tasks: {
    // A card an automation creates has to reach open boards exactly like one
    // created through the REST API, which is the layer that broadcasts.
    createTask: async (body) => {
      const task = await tasksService.createTask(body);
      broadcastTaskUpdate(task, 'created');
      return task;
    },
  },
  notify: {
    push: ({ userId, message, automationName }) => {
      // Single-user installation: with no explicit recipient the notification
      // goes to the account that owns the server.
      const recipient = userId ?? userDb.getFirstUser()?.id;
      if (!recipient) {
        throw new Error('No user to notify');
      }

      notifyUserIfEnabled({
        userId: recipient,
        event: createNotificationEvent({
          provider: 'claude',
          kind: 'info',
          code: 'agent.notification',
          meta: { message, sessionName: automationName },
          severity: 'info',
        }),
      });
    },
  },
  usage: {
    getUsage: (profileId) => profileUsageService.getUsage(profileId),
  },
  board: {
    listReadyBacklog: (project) => taskDependenciesDb.listReadyBacklogByProject(project),
    countActiveInProgress: (project) => taskDependenciesDb.countActiveInProgressByProject(project),
    listParentsAwaitingIntegration: (project) => taskDependenciesDb.listParentsAwaitingIntegration(project),
    listSubtasks: (parentTaskId) => taskDependenciesDb.listSubtasks(parentTaskId),
    getParentTask: (taskId) => {
      const parentId = taskDependenciesDb.get(taskId)?.parent_task_id ?? null;
      return parentId ? tasksDb.get(parentId) : null;
    },
    listUpstreamTasks: (taskId) => taskDependenciesDb.listUpstream(taskId),
    getTask: (taskId) => tasksDb.get(taskId),
    // Same reason `createTask` broadcasts: a card the server moves has to reach
    // open boards exactly like one moved through the REST API.
    //
    // Compare-and-swap, smallest-window form: the multi-second gap the guard
    // exists for is the worktree creation the caller awaits before this runs,
    // not the read-then-write below it. `tasksService.updateTask` has no
    // conditional write of its own, so the check happens here, immediately
    // before the write it gates.
    moveToInProgress: async (taskId, worktreeBranch, expectedStage) => {
      const current = tasksDb.get(taskId);
      if (!current || current.stage !== expectedStage) {
        return null;
      }

      const task = await tasksService.updateTask(taskId, {
        stage: 'in_progress',
        worktree_branch: worktreeBranch,
      });
      broadcastTaskUpdate(task, 'updated');
      return task;
    },
    revertToBacklog: async (taskId) => {
      const task = await tasksService.updateTask(taskId, { stage: 'backlog' });
      broadcastTaskUpdate(task, 'updated');
    },
  },
  worktrees: {
    ensureWorktree: async ({ projectPath, branch, baseBranch }) => {
      // Reuse before create: a retried pickup must not trip over the worktree
      // its own previous attempt left behind.
      const entries = await listWorktreePorcelainEntries(projectPath, runGitCommand);
      const existing = entries.find((entry) => entry.branch === branch);
      if (existing) return { worktreePath: existing.path, branch };

      const created = await createWorktree(
        { projectPath, branch, baseBranch },
        {
          runGit: runGitCommand,
          fileSystem: { pathExists: async (p) => access(p).then(() => true, () => false) },
        },
      );
      return { worktreePath: created.worktreePath, branch: created.branch };
    },
  },
};

const firing = createAutomationFiringService(deps);
const triggers = createAutomationTriggerService(deps, firing);
const admin = createAutomationAdminService(automationsDb);

/** Automations management router, mounted by the entrypoint at `/api/automations`. */
export const automationsRoutes = createAutomationsRouter({ admin, firing, triggers });

/** Inbound webhook router, mounted by the entrypoint at `/api/automations/webhook` (no JWT). */
export const automationsWebhookRoutes = createAutomationWebhookRouter({ admin, firing, triggers });

const scheduler = createAutomationScheduler({
  runTick: (at) => triggers.runTick(at),
});

let unsubscribeFromTasks: (() => void) | null = null;

/**
 * Starts the engine: the minute clock, and the board subscription.
 *
 * Never throws — an installation whose automations cannot start must still
 * serve the rest of the application.
 */
export function startAutomations(): void {
  try {
    if (!unsubscribeFromTasks) {
      unsubscribeFromTasks = registerTaskStageListener(async (event) => {
        await triggers.onTaskStageChanged({ task: event.task, previousStage: event.previousStage });
      });
    }
    scheduler.start();
  } catch (error) {
    console.error('[automations] could not start the engine:', error);
  }
}

/** Stops the clock and unsubscribes from the board; safe to call more than once. */
export function stopAutomations(): void {
  try {
    scheduler.stop();
    unsubscribeFromTasks?.();
    unsubscribeFromTasks = null;
  } catch (error) {
    console.error('[automations] could not stop the engine:', error);
  }
}
