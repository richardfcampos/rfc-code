/**
 * Public surface of the Automations module.
 *
 * The entrypoint mounts two routers (management behind JWT, inbound webhooks
 * outside it), configures the provider runtimes it owns the imports for, and
 * starts/stops the engine alongside the rest of the server's lifecycle.
 */

export {
  automationsRoutes,
  automationsWebhookRoutes,
  configureAutomationRuntimes,
  startAutomations,
  stopAutomations,
} from './automations.module.js';

export type {
  AutomationFireResult,
  AutomationView,
  CreateTaskActionConfig,
  CronTriggerConfig,
  NotifyPushActionConfig,
  PromptAgentActionConfig,
  QuotaThresholdTriggerConfig,
  TaskStageTriggerConfig,
  WebhookTriggerConfig,
} from './automations.types.js';
