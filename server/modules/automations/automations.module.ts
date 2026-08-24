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

import { automationsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { orgPolicyService } from '@/modules/orgs/index.js';
import { profileUsageService } from '@/modules/profiles/index.js';
import { broadcastTaskUpdate, registerTaskStageListener, tasksService } from '@/modules/tasks/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

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

const agent: AutomationAgentGateway = createAutomationSpawnGateway({
  policy: orgPolicyService,
  registry: chatRunRegistry,
  createSession: ({ sessionId, provider, projectPath, profileId, worktreePath, worktreeBranch }) => {
    sessionsDb.createAppSession(sessionId, provider, projectPath, profileId, worktreePath, worktreeBranch);
  },
  // Read through a getter so the entrypoint can configure the runtimes after
  // this module graph has already been imported.
  get spawnFns() {
    return spawnFns;
  },
});

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
