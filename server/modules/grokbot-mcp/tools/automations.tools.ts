import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optBool, optInt, optObject, pick, S, schema, seg, str, tool, ToolInputError } from './tool-helpers.js';

const TRIGGER_KINDS = ['cron', 'task_stage', 'webhook', 'quota_threshold'] as const;
const ACTION_KINDS = ['prompt_agent', 'create_task', 'notify_push'] as const;

const TRIGGER_CONFIG_HELP =
  'Shape per trigger_kind: cron {cron: "<cron expression>"}; task_stage {toStage, fromStage?, project?} ' +
  '(stages backlog|in_progress|review|done); webhook {} (a secret is generated and returned once); ' +
  'quota_threshold {profileId, thresholdPct, cooldownMinutes?}.';
const ACTION_CONFIG_HELP =
  'Shape per action_kind: prompt_agent {projectPath, promptTemplate, provider?, profileId?, skill?, worktreePath?, worktreeBranch?}; ' +
  'create_task {project, title, description?, suggestedSkill?, assigneeProfileId?}; notify_push {message, userId?}.';

const AUTOMATION_ID = S.string('Automation id, as returned by automation_list.');

function automationPath(args: JsonObject, suffix = ''): string {
  return `/api/automations/${seg(str(args, 'automationId'))}${suffix}`;
}

/** Writes must fail early on a wrong container type; the server owns the per-kind content rules. */
function requireObject(args: JsonObject, name: string): JsonObject {
  const value = optObject(args, name);
  if (!value) {
    throw new ToolInputError(`${name} is required.`);
  }
  return value;
}

export const automationTools: ToolDefinition[] = [
  tool({
    name: 'automation_list',
    description: 'List every automation rule (trigger, action, enabled flag) so you can find an automationId.',
    inputSchema: schema({}),
    covers: ['GET /api/automations'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/automations' }),
  }),
  tool({
    name: 'automation_create',
    description:
      'Create an automation rule: when a trigger happens, run an action. ' +
      `${TRIGGER_CONFIG_HELP} ${ACTION_CONFIG_HELP} A webhook rule returns its secret once in the response; keep it.`,
    inputSchema: schema(
      {
        name: S.string('Human-readable rule name.'),
        trigger_kind: S.enumOf(TRIGGER_KINDS, 'What starts the rule.'),
        trigger_config: S.object(`Trigger settings. ${TRIGGER_CONFIG_HELP}`),
        action_kind: S.enumOf(ACTION_KINDS, 'What the rule does when it fires.'),
        action_config: S.object(`Action settings. ${ACTION_CONFIG_HELP}`),
        enabled: S.boolean('Whether the rule is active; defaults to the server default.'),
      },
      ['name', 'trigger_kind', 'action_kind', 'action_config'],
    ),
    covers: ['POST /api/automations'],
    run: (args, ctx) => {
      const body: JsonObject = {
        name: str(args, 'name'),
        trigger_kind: str(args, 'trigger_kind'),
        action_kind: str(args, 'action_kind'),
        action_config: requireObject(args, 'action_config'),
      };
      const triggerConfig = optObject(args, 'trigger_config');
      if (triggerConfig) body.trigger_config = triggerConfig;
      const enabled = optBool(args, 'enabled');
      if (enabled !== undefined) body.enabled = enabled;
      return ctx.api.dispatch({ method: 'POST', path: '/api/automations', body });
    },
  }),
  tool({
    name: 'automation_get',
    description: 'Read one automation rule with its trigger and action configuration.',
    inputSchema: schema({ automationId: AUTOMATION_ID }, ['automationId']),
    covers: ['GET /api/automations/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: automationPath(args) }),
  }),
  tool({
    name: 'automation_update',
    description:
      'Partially update an automation rule; only the keys you pass change. Use enabled=false to pause a rule. ' +
      `${TRIGGER_CONFIG_HELP} ${ACTION_CONFIG_HELP}`,
    inputSchema: schema(
      {
        automationId: AUTOMATION_ID,
        name: S.string('New rule name.'),
        enabled: S.boolean('Turn the rule on or off.'),
        trigger_kind: S.enumOf(TRIGGER_KINDS, 'New trigger kind; send trigger_config with it.'),
        trigger_config: S.object(`New trigger settings. ${TRIGGER_CONFIG_HELP}`),
        action_kind: S.enumOf(ACTION_KINDS, 'New action kind; send action_config with it.'),
        action_config: S.object(`New action settings. ${ACTION_CONFIG_HELP}`),
      },
      ['automationId'],
    ),
    covers: ['PATCH /api/automations/:id'],
    run: (args, ctx) => {
      optBool(args, 'enabled');
      optObject(args, 'trigger_config');
      optObject(args, 'action_config');
      const body = pick(args, ['name', 'enabled', 'trigger_kind', 'trigger_config', 'action_kind', 'action_config']);
      return ctx.api.dispatch({ method: 'PATCH', path: automationPath(args), body });
    },
  }),
  tool({
    name: 'automation_delete',
    description: 'Permanently delete an automation rule and stop it from firing.',
    inputSchema: schema({ automationId: AUTOMATION_ID }, ['automationId']),
    covers: ['DELETE /api/automations/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: automationPath(args) }),
  }),
  tool({
    name: 'automation_runs',
    description: 'List recent firings of an automation (status success|failed|skipped, detail, attempts), newest first.',
    inputSchema: schema(
      { automationId: AUTOMATION_ID, limit: S.integer('Number of runs to return, 1 to 200; server default 50.') },
      ['automationId'],
    ),
    covers: ['GET /api/automations/:id/runs'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'GET', path: automationPath(args, '/runs'), query: { limit: optInt(args, 'limit') } }),
  }),
  tool({
    name: 'automation_fire',
    description:
      'Fire an automation by hand right now, bypassing its trigger (works even when disabled). Use it to test a rule; the run is recorded in its history.',
    inputSchema: schema({ automationId: AUTOMATION_ID }, ['automationId']),
    covers: ['POST /api/automations/:id/fire'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: automationPath(args, '/fire') }),
  }),
  tool({
    name: 'automation_rotate_webhook_secret',
    description:
      'Generate a new secret for a webhook-triggered automation. The new secret is returned once and the old one stops working.',
    inputSchema: schema({ automationId: AUTOMATION_ID }, ['automationId']),
    covers: ['POST /api/automations/:id/webhook-secret'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: automationPath(args, '/webhook-secret') }),
  }),
];
