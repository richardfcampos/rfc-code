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
  AutomationServiceDeps,
  AutomationTriggerContext,
  CreateTaskActionConfig,
  NotifyPushActionConfig,
  PromptAgentActionConfig,
} from '../automations.types.js';
import { parseStoredConfig } from '../automations.validation.js';

import { interpolate } from './automation-template.js';

const DEFAULT_PROVIDER: LLMProvider = 'claude';

/**
 * Asks an agent to pick the work up.
 *
 * The account is never chosen here: the gateway runs the org policy resolver,
 * so an automation can request a profile but cannot grant itself one the org
 * does not allow. A configured skill becomes a hint line appended to the
 * prompt — the provider reads it as an instruction, which is the only way to
 * suggest a skill that works across every runtime.
 */
async function runPromptAgent(
  deps: AutomationServiceDeps,
  config: PromptAgentActionConfig,
  context: AutomationTriggerContext,
): Promise<string> {
  const prompt = interpolate(config.promptTemplate, context.variables).trim();
  if (!prompt) {
    throw new AutomationValidationError('The prompt template produced an empty prompt');
  }

  const skill = config.skill?.trim();
  const fullPrompt = skill ? `${prompt}\n\nUse the "${skill}" skill for this work.` : prompt;

  const result = await deps.agent.promptAgent({
    projectPath: config.projectPath,
    provider: config.provider ?? DEFAULT_PROVIDER,
    prompt: fullPrompt,
    requestedProfileId: config.profileId ?? null,
    worktreePath: config.worktreePath ?? null,
    worktreeBranch: config.worktreeBranch ?? null,
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

/** Runs one attempt of an automation's action and returns its history detail. */
export async function executeAutomationAction(
  deps: AutomationServiceDeps,
  automation: AutomationRow,
  context: AutomationTriggerContext,
): Promise<string> {
  const config = parseStoredConfig(automation.action_config);

  if (automation.action_kind === 'prompt_agent') {
    return runPromptAgent(deps, config as unknown as PromptAgentActionConfig, context);
  }
  if (automation.action_kind === 'create_task') {
    return runCreateTask(deps, automation, config as unknown as CreateTaskActionConfig, context);
  }
  return runNotifyPush(deps, automation, config as unknown as NotifyPushActionConfig, context);
}
