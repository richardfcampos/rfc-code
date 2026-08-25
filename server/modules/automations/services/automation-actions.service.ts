/**
 * What an automation actually does once it fires.
 *
 * Each action returns the one-line detail that goes into the execution history,
 * and throws on failure — the retry policy lives one layer up, in the service,
 * so an action stays a single attempt at a single side effect.
 */

import type { AutomationRow } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

import { AutomationValidationError } from '../automations.errors.js';
import type {
  AutomationActionResult,
  AutomationServiceDeps,
  AutomationTriggerContext,
  CreateTaskActionConfig,
  NotifyPushActionConfig,
  PickupTaskActionConfig,
  PromptAgentActionConfig,
} from '../automations.types.js';
import { unrecordedSkip } from '../automations.types.js';
import { parseStoredConfig } from '../automations.validation.js';

import { interpolate } from './automation-template.js';
import { integrateParentTask } from './task-integration.service.js';
import { pickupTask } from './task-pickup.service.js';

const DEFAULT_PROVIDER: LLMProvider = 'claude';

/**
 * Asks an agent to pick the work up.
 *
 * The account is never chosen here: the gateway runs the org policy resolver,
 * so an automation can request a profile but cannot grant itself one the org
 * does not allow. A configured skill becomes a hint line appended to the
 * prompt — the provider reads it as an instruction, which is the only way to
 * suggest a skill that works across every runtime.
 *
 * `useTaskWorktree` overrides the static `worktreePath`/`worktreeBranch` with
 * whatever the firing task is checked out in — one rule serves every task on
 * a board, so a static path in config cannot name it. Guarded the same way a
 * pickup is: a branch with a live session already on it is skipped rather
 * than joined by a second agent — and because that guard can be true for the
 * mundane reason that the branch's own author is still mid-run (a card moved
 * to review from inside the very session that is about to be checked), the
 * skip is reported as unrecorded rather than a plain detail: this exact rule
 * gets another look the next time the task's stage changes, instead of being
 * locked out forever by a run row it never actually produced.
 *
 * Dispatched as `isAuthoringRun: false`: this action is never the ticket's
 * own pickup or integration, so a session it spawns is tagged as an
 * auxiliary run rather than the branch's author.
 */
async function runPromptAgent(
  deps: AutomationServiceDeps,
  config: PromptAgentActionConfig,
  context: AutomationTriggerContext,
): Promise<AutomationActionResult> {
  const prompt = interpolate(config.promptTemplate, context.variables).trim();
  if (!prompt) {
    throw new AutomationValidationError('The prompt template produced an empty prompt');
  }

  const skill = config.skill?.trim();
  const fullPrompt = skill ? `${prompt}\n\nUse the "${skill}" skill for this work.` : prompt;

  let worktreePath = config.worktreePath ?? null;
  let worktreeBranch = config.worktreeBranch ?? null;
  if (config.useTaskWorktree && context.task?.worktree_branch) {
    worktreeBranch = context.task.worktree_branch;
    if (deps.agent.hasLiveSessionForBranch(worktreeBranch)) {
      return unrecordedSkip(
        `Task ${context.task.id} already has a live agent session on ${worktreeBranch}; skipping`,
      );
    }
    ({ worktreePath } = await deps.worktrees.ensureWorktree({
      projectPath: config.projectPath,
      branch: worktreeBranch,
      baseBranch: null,
    }));
  }

  const result = await deps.agent.promptAgent({
    projectPath: config.projectPath,
    provider: config.provider ?? DEFAULT_PROVIDER,
    prompt: fullPrompt,
    requestedProfileId: config.profileId ?? null,
    worktreePath,
    worktreeBranch,
    isAuthoringRun: false,
  });

  return `Prompted an agent in session ${result.sessionId}${
    result.profileId ? ` on profile ${result.profileId}` : ''
  }`;
}

/**
 * Puts a card on the board.
 *
 * Origin is forced to `automation` and stamped with the rule's name, so a task
 * nobody remembers asking for can always be traced back to what created it.
 */
async function runCreateTask(
  deps: AutomationServiceDeps,
  automation: AutomationRow,
  config: CreateTaskActionConfig,
  context: AutomationTriggerContext,
): Promise<string> {
  const title = interpolate(config.title, context.variables).trim();
  if (!title) {
    throw new AutomationValidationError('The title template produced an empty title');
  }

  const task = await deps.tasks.createTask({
    title,
    project: config.project,
    description: config.description ? interpolate(config.description, context.variables) : undefined,
    origin: 'automation',
    origin_detail: automation.name,
    suggested_skill: config.suggestedSkill,
    assignee_profile_id: config.assigneeProfileId,
  });

  return `Created task ${task.id} on ${task.project_name}`;
}

function runNotifyPush(
  deps: AutomationServiceDeps,
  automation: AutomationRow,
  config: NotifyPushActionConfig,
  context: AutomationTriggerContext,
): string {
  const message = interpolate(config.message, context.variables).trim();
  if (!message) {
    throw new AutomationValidationError('The message template produced an empty message');
  }

  deps.notify.push({ userId: config.userId, message, automationName: automation.name });
  return 'Sent a push notification';
}

/**
 * Runs one attempt of an automation's action and returns its history detail,
 * or an unrecorded skip when the action hit a guard whose cause is not
 * durable (see `AutomationUnrecordedSkip`).
 *
 * Every action kind gets an explicit branch — there is no trailing default
 * that runs a different action for a kind it was not written for. A kind
 * this dispatcher does not recognise is a data problem (a rule written by a
 * newer version, a hand-edited row) and fails loudly instead of silently
 * doing something else.
 */
export async function executeAutomationAction(
  deps: AutomationServiceDeps,
  automation: AutomationRow,
  context: AutomationTriggerContext,
): Promise<AutomationActionResult> {
  const config = parseStoredConfig(automation.action_config);

  if (automation.action_kind === 'prompt_agent') {
    return runPromptAgent(deps, config as unknown as PromptAgentActionConfig, context);
  }
  if (automation.action_kind === 'create_task') {
    return runCreateTask(deps, automation, config as unknown as CreateTaskActionConfig, context);
  }
  if (automation.action_kind === 'pickup_task') {
    const pickupConfig = config as unknown as PickupTaskActionConfig;
    return context.intent === 'integrate'
      ? integrateParentTask(deps, pickupConfig, context)
      : pickupTask(deps, pickupConfig, context);
  }
  if (automation.action_kind === 'notify_push') {
    return runNotifyPush(deps, automation, config as unknown as NotifyPushActionConfig, context);
  }

  throw new AutomationValidationError(`Unknown automation action kind: ${String(automation.action_kind)}`);
}
