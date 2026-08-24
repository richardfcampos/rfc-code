/**
 * Configuration writes for automation rules.
 *
 * Kept apart from the firing engine: creating a rule is a user action behind a
 * JWT, while firing one is something the server does to itself. The only piece
 * of shared state between the two halves is the stored config, and this file is
 * the only one that writes it.
 */

import type { AutomationRow } from '@/modules/database/index.js';

import { AutomationValidationError } from '../automations.errors.js';
import { toAutomationView } from '../automations.service.js';
import type { AutomationRepositoryGateway, AutomationView } from '../automations.types.js';
import {
  parseStoredConfig,
  validateActionConfig,
  validateActionKind,
  validateEnabled,
  validateName,
  validateTriggerConfig,
  validateTriggerKind,
} from '../automations.validation.js';

import { generateWebhookSecret, hashWebhookSecret } from './automation-webhook-secret.js';

/**
 * A rule, plus the webhook secret when one was just minted.
 *
 * The plaintext exists only in this response: it is hashed on the way into the
 * database, so a caller that loses it has to rotate rather than look it up.
 */
export interface AutomationMutationResult {
  automation: AutomationView;
  secret?: string;
}

export interface AutomationAdminService {
  create(body: Record<string, unknown>): AutomationMutationResult;
  list(): AutomationView[];
  get(automation: AutomationRow): AutomationView;
  update(automation: AutomationRow, body: Record<string, unknown>): AutomationMutationResult;
  remove(automation: AutomationRow): AutomationView;
  rotateWebhookSecret(automation: AutomationRow): AutomationMutationResult;
}

export function createAutomationAdminService(
  repository: AutomationRepositoryGateway,
): AutomationAdminService {
  function persistUpdate(automationId: string, fields: Parameters<AutomationRepositoryGateway['update']>[1]): AutomationRow {
    const updated = repository.update(automationId, fields);
    if (!updated) {
      // The row was deleted between the lookup and the write; treated as a
      // validation failure rather than a crash, since the caller can retry.
      throw new AutomationValidationError('The automation no longer exists');
    }
    return updated;
  }

  return {
    create(body: Record<string, unknown>): AutomationMutationResult {
      const name = validateName(body.name);
      const triggerKind = validateTriggerKind(body.trigger_kind ?? body.triggerKind);
      const actionKind = validateActionKind(body.action_kind ?? body.actionKind);
      const actionConfig = validateActionConfig(actionKind, body.action_config ?? body.actionConfig);
      const triggerConfig = validateTriggerConfig(triggerKind, body.trigger_config ?? body.triggerConfig);

      let secret: string | undefined;
      if (triggerKind === 'webhook') {
        secret = generateWebhookSecret();
        triggerConfig.secretHash = hashWebhookSecret(secret);
      }

      const created = repository.create({
        name,
        enabled: body.enabled === undefined ? true : validateEnabled(body.enabled),
        triggerKind,
        triggerConfig: JSON.stringify(triggerConfig),
        actionKind,
        actionConfig: JSON.stringify(actionConfig),
      });

      return { automation: toAutomationView(created), secret };
    },

    list: () => repository.list().map(toAutomationView),

    get: (automation) => toAutomationView(automation),

    update(automation: AutomationRow, body: Record<string, unknown>): AutomationMutationResult {
      const fields: Parameters<AutomationRepositoryGateway['update']>[1] = {};

      if (body.name !== undefined) {
        fields.name = validateName(body.name);
      }
      if (body.enabled !== undefined) {
        fields.enabled = validateEnabled(body.enabled);
      }

      const rawTriggerKind = body.trigger_kind ?? body.triggerKind;
      const rawActionKind = body.action_kind ?? body.actionKind;
      const triggerKind = rawTriggerKind === undefined ? automation.trigger_kind : validateTriggerKind(rawTriggerKind);
      const actionKind = rawActionKind === undefined ? automation.action_kind : validateActionKind(rawActionKind);

      let secret: string | undefined;

      const rawTriggerConfig = body.trigger_config ?? body.triggerConfig;
      if (rawTriggerConfig !== undefined || triggerKind !== automation.trigger_kind) {
        // A config is always re-validated against the kind it will run under,
        // so switching kinds cannot leave a rule holding the previous kind's
        // parameters.
        const previous = parseStoredConfig(automation.trigger_config);
        const triggerConfig = validateTriggerConfig(triggerKind, rawTriggerConfig ?? {}, previous);

        if (triggerKind === 'webhook' && typeof triggerConfig.secretHash !== 'string') {
          // Becoming a webhook (or repairing one whose digest was lost) mints a
          // credential: an endpoint without one would refuse every call.
          secret = generateWebhookSecret();
          triggerConfig.secretHash = hashWebhookSecret(secret);
        }
        fields.triggerConfig = JSON.stringify(triggerConfig);
      }
      if (triggerKind !== automation.trigger_kind) {
        fields.triggerKind = triggerKind;
      }

      const rawActionConfig = body.action_config ?? body.actionConfig;
      if (rawActionConfig !== undefined || actionKind !== automation.action_kind) {
        fields.actionConfig = JSON.stringify(validateActionConfig(actionKind, rawActionConfig ?? {}));
      }
      if (actionKind !== automation.action_kind) {
        fields.actionKind = actionKind;
      }

      return { automation: toAutomationView(persistUpdate(automation.automation_id, fields)), secret };
    },

    remove(automation: AutomationRow): AutomationView {
      const view = toAutomationView(automation);
      repository.delete(automation.automation_id);
      return view;
    },

    rotateWebhookSecret(automation: AutomationRow): AutomationMutationResult {
      if (automation.trigger_kind !== 'webhook') {
        throw new AutomationValidationError('Only webhook automations have a secret');
      }

      const secret = generateWebhookSecret();
      const triggerConfig = parseStoredConfig(automation.trigger_config);
      triggerConfig.secretHash = hashWebhookSecret(secret);

      const updated = persistUpdate(automation.automation_id, {
        triggerConfig: JSON.stringify(triggerConfig),
      });
      return { automation: toAutomationView(updated), secret };
    },
  };
}
