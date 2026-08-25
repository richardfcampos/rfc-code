/**
 * Maestro tools: the calls a leader session uses to split work up and hand it
 * out.
 *
 * Three steps of one loop — decompose a task into subtasks with dependencies,
 * ask which of them can start now, and delegate one to a worker. The leader
 * never names a project (its token decides that) and never picks an account
 * profile off-policy: an omitted `profileId` is filled in by the same
 * quota-aware recommender the spawn path uses, and an explicit one is checked
 * against the org policy before anything is written.
 *
 * Delegation is deliberately two things at once — an assignment on the board
 * and a handoff message in the worker's inbox — because either on its own goes
 * unnoticed: an assignment nobody is told about, or a message about work that
 * is not formally anybody's.
 */

import type { AgentMessageRow, SubtaskRow, TaskRow } from '@/modules/database/index.js';
import type { ProfileRecommendation } from '@/modules/orgs/index.js';
import type { TaskDecomposition } from '@/modules/tasks/index.js';

import { AgentBridgeValidationError } from './agent-bridge.errors.js';
import {
  readOptionalString,
  readRequiredString,
  requireTaskInScope,
} from './agent-bridge.tool-input.js';
import type { AgentBridgeSessionScope, AgentBridgeToolDeps } from './agent-bridge.types.js';

export const MAESTRO_TOOL_NAMES = ['task_decompose', 'task_ready_list', 'task_delegate'] as const;
export type MaestroToolName = (typeof MAESTRO_TOOL_NAMES)[number];

/** What a delegation produced: the assignment, the handoff, and why this profile. */
export type TaskDelegation = {
  task: TaskRow;
  /** Null when the caller named no recipient — the task is assigned, nobody was told. */
  message: AgentMessageRow | null;
  /** Present only when the profile was chosen here instead of being named by the caller. */
  recommendation: ProfileRecommendation | null;
};

export function isMaestroToolName(toolName: string): toolName is MaestroToolName {
  return (MAESTRO_TOOL_NAMES as readonly string[]).includes(toolName);
}

/**
 * Breaks a task on this project's board into subtasks.
 *
 * The plan is written atomically by the tasks module; everything this layer
 * adds is scope (the parent must be on the caller's own board) and the
 * board fan-out, so a decomposition an agent wrote appears exactly like one a
 * human dragged in.
 */
function taskDecompose(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): TaskDecomposition {
  const parentTaskId = readRequiredString(input.parentTaskId, 'parentTaskId');
  const parent = requireTaskInScope(deps, scope, parentTaskId);

  const decomposition = deps.decomposition.decompose(parent.id, {
    subtasks: input.subtasks,
    // Board cards show where work came from; the leader's session id is what
    // makes each subtask traceable back to the run that planned it.
    origin_detail: scope.sessionId,
  });

  for (const subtask of decomposition.subtasks) {
    deps.broadcast(subtask, 'created');
  }
  deps.broadcast(decomposition.parent, 'updated');

  return decomposition;
}

/** Subtasks of a parent that can be started right now. */
function taskReadyList(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): { parentTaskId: string; subtasks: SubtaskRow[] } {
  const parentTaskId = readRequiredString(input.parentTaskId, 'parentTaskId');
  const parent = requireTaskInScope(deps, scope, parentTaskId);

  return { parentTaskId: parent.id, subtasks: deps.decomposition.listReady(parent.id) };
}

/** The handoff a worker reads: what to do, and where it sits in the plan. */
function describeTask(task: TaskRow, delegatedBy: string): string {
  const lines = [
    `Task id: ${task.id}`,
    `Title: ${task.title}`,
    task.suggested_skill ? `Suggested skill: ${task.suggested_skill}` : null,
    '',
    task.description ?? '(no description)',
    '',
    `Delegated by session ${delegatedBy}. It is assigned to you on the board:`,
    'move it to in_progress when you start, review or done when you finish, and',
    'acknowledge this message so the leader knows you picked it up.',
  ];
  return lines.filter((line) => line !== null).join('\n');
}

/**
 * Assigns a task and tells the worker about it.
 *
 * Order matters: the profile is settled before anything is written (a refusal
 * must leave the board untouched), then the assignment, then the handoff. If
 * the message fails — a recipient that has since died is the usual reason — the
 * assignment stands and the error names the reason, so the leader can delegate
 * the same task to somebody else without cleaning up first.
 */
async function taskDelegate(
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): Promise<TaskDelegation> {
  const taskId = readRequiredString(input.taskId, 'taskId');
  const toSessionId = readOptionalString(input.toSessionId, 'toSessionId');
  const requestedProfileId = readOptionalString(input.profileId, 'profileId');

  const task = requireTaskInScope(deps, scope, taskId);

  // Work whose prerequisites are still open is not delegable: the worker would
  // start against a state that does not exist yet, and nothing later in the
  // loop would catch it.
  const blockers = deps.decomposition.listBlockers(task.id);
  if (blockers.length > 0) {
    throw new AgentBridgeValidationError(
      `Task "${task.id}" still waits on: ${blockers
        .map((blocker) => `${blocker.title} (${blocker.id}, ${blocker.stage})`)
        .join('; ')}. Delegate it once those are done.`,
    );
  }

  let recommendation: ProfileRecommendation | null = null;
  let profileId: string;
  if (requestedProfileId) {
    // An account the org refuses for this project must be refused whatever the
    // task is, and the refusal reason is what the leader gets to read.
    deps.policy.assertProfileAllowed(scope.projectPath, requestedProfileId);
    profileId = requestedProfileId;
  } else {
    recommendation = await deps.recommend.recommend(scope.projectPath);
    profileId = recommendation.profileId;
  }

  const assigned = await deps.tasks.updateTask(task.id, { assignee_profile_id: profileId });

  // The delegation trail lives on the task, not only in the leader's head: who
  // it went to, on which account, and why that account was picked.
  deps.tasks.addEvidence(task.id, {
    kind: 'note',
    content: [
      `Delegated by session ${scope.sessionId}`,
      toSessionId ? `to session ${toSessionId}` : 'with no recipient session',
      `on profile ${profileId}`,
      recommendation
        ? `(recommended: ${recommendation.role}, ${recommendation.reason}${
            recommendation.usagePct === null ? '' : `, usage ${recommendation.usagePct}%`
          })`
        : '(profile named by the leader; allowed by org policy)',
    ].join(' '),
  });

  deps.broadcast(assigned, 'updated');

  const message = toSessionId
    ? deps.messages.send(scope.sessionId, {
        toSessionId,
        subject: `Task assigned: ${assigned.title}`.slice(0, 200),
        body: describeTask(assigned, scope.sessionId),
      })
    : null;

  return { task: assigned, message, recommendation };
}

export async function runMaestroTool(
  toolName: MaestroToolName,
  input: Record<string, unknown>,
  scope: AgentBridgeSessionScope,
  deps: AgentBridgeToolDeps,
): Promise<unknown> {
  switch (toolName) {
    case 'task_decompose':
      return taskDecompose(input, scope, deps);
    case 'task_ready_list':
      return taskReadyList(input, scope, deps);
    case 'task_delegate':
      return taskDelegate(input, scope, deps);
  }
}
