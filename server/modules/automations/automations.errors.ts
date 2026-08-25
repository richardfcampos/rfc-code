/**
 * Named failures of the Automations module: `server/modules/automations`.
 *
 * All extend the shared `AppError`, so the global error middleware maps them
 * to a status and a `{ success: false, error: { code, message } }` body without
 * any route-level branching.
 */

import { AppError } from '@/shared/utils.js';

export class AutomationValidationError extends AppError {
  constructor(message: string) {
    super(message, { code: 'AUTOMATION_VALIDATION_ERROR', statusCode: 400 });
    this.name = 'AutomationValidationError';
  }
}

export class AutomationNotFoundError extends AppError {
  constructor(id: string) {
    super(`Automation "${id}" not found`, { code: 'AUTOMATION_NOT_FOUND', statusCode: 404 });
    this.name = 'AutomationNotFoundError';
  }
}

/**
 * A webhook call that presented no secret, or the wrong one.
 *
 * Deliberately says nothing about which of the two it was, and never names the
 * automation: an unauthenticated caller learns nothing from probing.
 */
export class AutomationWebhookAuthError extends AppError {
  constructor() {
    super('Invalid webhook credentials', { code: 'AUTOMATION_WEBHOOK_UNAUTHORIZED', statusCode: 401 });
    this.name = 'AutomationWebhookAuthError';
  }
}
