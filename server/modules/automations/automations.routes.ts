/**
 * REST surface of the Automations module: `/api/automations`.
 *
 * Two routers with two different callers, the same split the agent bridge uses.
 * The management router is a normal user surface behind `authenticateToken`.
 * The webhook router is what an outside system posts to; it holds no user JWT,
 * so it authenticates with the automation's own secret and is mounted outside
 * the JWT middleware.
 *
 * Handlers stay thin: validation and business rules live in the services, and
 * named errors bubble to the global error middleware.
 */

import express, { type Request, type Response } from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { AutomationAdminService } from './services/automation-admin.service.js';
import type { AutomationTriggerService } from './services/automation-triggers.service.js';
import { readWebhookSecret, verifyWebhookSecret } from './services/automation-webhook-secret.js';
import { AutomationValidationError, AutomationWebhookAuthError } from './automations.errors.js';
import type { AutomationFiringService } from './automations.service.js';
import { parseStoredConfig } from './automations.validation.js';

const MAX_HISTORY_LIMIT = 200;
const DEFAULT_HISTORY_LIMIT = 50;

export interface AutomationRouterDeps {
  admin: AutomationAdminService;
  firing: AutomationFiringService;
  triggers: AutomationTriggerService;
}

function readBody(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {}) as Record<string, unknown>;
}

function readHistoryLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_HISTORY_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw new AutomationValidationError(`limit must be an integer between 1 and ${MAX_HISTORY_LIMIT}`);
  }
  return limit;
}

/** Management router, mounted behind `authenticateToken` at `/api/automations`. */
export function createAutomationsRouter(deps: AutomationRouterDeps): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(createApiSuccessResponse({ automations: deps.admin.list() }));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const result = deps.admin.create(readBody(req));
      res.status(201).json(createApiSuccessResponse(result));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const automation = deps.firing.requireAutomation(req.params.id);
      res.json(createApiSuccessResponse({ automation: deps.admin.get(automation) }));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const automation = deps.firing.requireAutomation(req.params.id);
      res.json(createApiSuccessResponse(deps.admin.update(automation, readBody(req))));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const automation = deps.firing.requireAutomation(req.params.id);
      res.json(createApiSuccessResponse({ automation: deps.admin.remove(automation) }));
    }),
  );

  router.get(
    '/:id/runs',
    asyncHandler(async (req: Request, res: Response) => {
      const runs = deps.firing.listHistory(req.params.id, readHistoryLimit(req.query.limit));
      res.json(createApiSuccessResponse({ runs }));
    }),
  );

  /**
   * Fires a rule by hand, bypassing its trigger and its dedupe key.
   *
   * This is how a rule is tested before it is trusted with a schedule, so it
   * runs even while the rule is disabled — and it is recorded in the history
   * like any other firing, never hidden.
   */
  router.post(
    '/:id/fire',
    asyncHandler(async (req: Request, res: Response) => {
      const automation = deps.firing.requireAutomation(req.params.id);
      const result = await deps.triggers.fireManually(automation);
      res.json(createApiSuccessResponse({ result }));
    }),
  );

  router.post(
    '/:id/webhook-secret',
    asyncHandler(async (req: Request, res: Response) => {
      const automation = deps.firing.requireAutomation(req.params.id);
      res.json(createApiSuccessResponse(deps.admin.rotateWebhookSecret(automation)));
    }),
  );

  return router;
}

/**
 * Inbound webhook router, mounted OUTSIDE `authenticateToken` at
 * `/api/automations/webhook`.
 *
 * Everything an unauthenticated caller can learn here is deliberately the same
 * whether the automation exists, is of another kind, or is disabled: the secret
 * is checked first, and every other refusal is the same 401 as a wrong secret,
 * so the endpoint cannot be used to enumerate rules.
 */
export function createAutomationWebhookRouter(deps: AutomationRouterDeps): express.Router {
  const router = express.Router();

  router.post(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const automation = deps.firing.findAutomation(req.params.id);
      const config = automation ? parseStoredConfig(automation.trigger_config) : {};
      const presented = readWebhookSecret(req.headers as Record<string, unknown>);

      // One refusal for every reason: unknown id, wrong secret, wrong trigger
      // kind and disabled rule are indistinguishable from the outside.
      if (
        !automation ||
        !verifyWebhookSecret(presented, config.secretHash) ||
        automation.trigger_kind !== 'webhook' ||
        automation.enabled !== 1
      ) {
        throw new AutomationWebhookAuthError();
      }

      const body = readBody(req);
      const idempotencyKey =
        typeof req.headers['x-idempotency-key'] === 'string'
          ? req.headers['x-idempotency-key']
          : typeof body.dedupeKey === 'string'
            ? body.dedupeKey
            : null;

      const result = await deps.triggers.fireWebhook(automation, body, idempotencyKey);
      res.json(createApiSuccessResponse({ result }));
    }),
  );

  return router;
}
