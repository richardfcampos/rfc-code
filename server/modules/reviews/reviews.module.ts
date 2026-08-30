/**
 * Composition root for the Reviews module, mounted by the server entrypoint at
 * `/api/reviews`.
 *
 * Two things are wired here that nothing else may do: the board's stage-change
 * subscription (the seam several modules share, so registration is explicit
 * and idempotent) and the session runtime used to route comments back to the
 * agent, which arrives at boot the same way the collab runtime does.
 */

import { describeAgentBridgeRegistrationForSession } from '@/modules/agent-bridge/index.js';
import { projectsDb, sessionsDb, tasksDb } from '@/modules/database/index.js';
import {
  broadcastTaskUpdate,
  registerTaskStageListener,
  tasksService,
  type TaskStageChangedEvent,
} from '@/modules/tasks/index.js';
import { mergeWorktree, removeWorktree } from '@/modules/worktrees/index.js';
import { deleteOrArchiveProject } from '@/modules/projects/index.js';
import { runGitCommand } from '@/shared/git-command.js';
import type { TaskRow } from '@/modules/database/index.js';

import { broadcastReviewUpdate } from './review-update-broadcast.js';
import { createReviewsRouter } from './reviews.routes.js';
import { createReviewsService } from './reviews.service.js';
import type { SessionMessageSender } from './services/review-comment-delivery.service.js';
import {
  createSessionMessageSender,
  type SessionMessageSenderDeps,
} from './services/session-message-sender.service.js';

/**
 * Installed at boot by `configureReviewsRuntime`. Until then, comments are
 * still persisted — they are simply reported as "not routed".
 */
let sessionMessageSender: SessionMessageSender | null = null;

/** One-shot LLM entry point for the AI brief; installed at boot like the sender. */
let briefGenerator: ((prompt: string, options: { cwd: string }) => Promise<string>) | null = null;

/**
 * Moving a card to Done from an approval is a board mutation like any other,
 * so it goes through the tasks service and reaches open boards on the same
 * broadcast a drag would use.
 */
async function setTaskStage(taskId: string, stage: TaskRow['stage']): Promise<TaskRow> {
  const task = await tasksService.updateTask(taskId, { stage });
  broadcastTaskUpdate(task, 'updated');
  return task;
}

export const reviewsService = createReviewsService({
  runGit: runGitCommand,
  getTaskById: (taskId) => tasksDb.get(taskId),
  getProjectPathById: (projectId) => projectsDb.getProjectPathById(projectId),
  setTaskStage,
  mergeWorktree: (input) =>
    mergeWorktree(input, {
      runGit: runGitCommand,
      removeWorktree: (removeInput) =>
        removeWorktree(removeInput, {
          runGit: runGitCommand,
          projects: {
            getProjectByPath: (projectPath: string) => projectsDb.getProjectPath(projectPath),
            archiveProject: (projectId: string) => deleteOrArchiveProject(projectId, false),
          },
        }),
    }),
  delivery: {
    listSessionsByProjectPath: (projectPath) => sessionsDb.getSessionsByProjectPath(projectPath),
    // Read through a getter so the runtime installed later is picked up.
    get sendSessionMessage(): SessionMessageSender | null {
      return sessionMessageSender;
    },
  },
  broadcast: broadcastReviewUpdate,
  // Read through a getter so the runtime installed later is picked up.
  get generateText() {
    return briefGenerator;
  },
});

export const reviewsRoutes = createReviewsRouter(reviewsService);

/** Opens a review when a card with a worktree lands in the Review column. */
function onTaskStageChanged(event: TaskStageChangedEvent): void {
  if (event.task.stage !== 'review') {
    return;
  }
  reviewsService.openReviewForTask(event.task);
}

let unsubscribeStageListener: (() => void) | null = null;

/**
 * Wires the module's runtime dependencies at server boot.
 *
 * Idempotent: calling it twice replaces the runtime and keeps exactly one
 * stage subscription, so a restarted boot sequence cannot double-open reviews.
 */
export function configureReviewsRuntime(deps: {
  spawnFns: SessionMessageSenderDeps['spawnFns'];
  generateText?: (prompt: string, options: { cwd: string }) => Promise<string>;
}): void {
  briefGenerator = deps.generateText ?? null;
  sessionMessageSender = createSessionMessageSender({
    spawnFns: deps.spawnFns,
    // Wired here rather than required from the caller: the entrypoint already
    // hands the automations module its bridge access the same way, and a
    // routed turn needs the identical port — resolve a session's stdio MCP
    // registration, minted fresh per call.
    bridge: { describeRegistrationForSession: describeAgentBridgeRegistrationForSession },
  });
  unsubscribeStageListener?.();
  unsubscribeStageListener = registerTaskStageListener(onTaskStageChanged);
}
