/**
 * REST surface for organizations: `/api/orgs`.
 *
 * Two very different jobs share this router. The CRUD half configures policy
 * (orgs, project rules, the per-org profile allow-list) through
 * `orgAdminService`, which owns every validation rule. The read-only half
 * (`/allowed-profiles`, `/recommend`) answers the same questions the spawn
 * choke point asks, so the UI can offer exactly the accounts a spawn would
 * accept instead of guessing and failing later.
 *
 * Handlers stay thin: they parse transport-level input and wrap results in the
 * shared success envelope. Named errors — including `OrgPolicyError` from the
 * policy services — bubble to the global error middleware, which maps them via
 * `AppError.statusCode` (403 for a denial).
 */

import express, { type Request, type Response } from 'express';

import type {
  OrgPolicyService,
  OrgRecommendService,
} from '@/modules/orgs/orgs.types.js';
import {
  OrgValidationError,
  type OrgAdminService,
} from '@/modules/orgs/services/org-admin.service.js';
import type { LLMProvider } from '@/shared/types.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const PROVIDERS: readonly LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];

export interface OrgsRouterDeps {
  admin: OrgAdminService;
  policy: OrgPolicyService;
  recommend: OrgRecommendService;
}

/** `provider` narrows both read endpoints; absent means "every provider". */
function readProvider(value: unknown): LLMProvider | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !PROVIDERS.includes(value as LLMProvider)) {
    throw new OrgValidationError(`provider must be one of: ${PROVIDERS.join(', ')}`);
  }
  return value as LLMProvider;
}

/** An absent project resolves to the default org, which is a valid question. */
function readProjectPath(value: unknown): string | null {
  const projectPath = typeof value === 'string' ? value.trim() : '';
  return projectPath.length > 0 ? projectPath : null;
}

/** Express types a route parameter as possibly repeated; only the first matters here. */
function readParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function readBody(body: unknown): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}

/**
 * Builds the Orgs HTTP router around injected application services.
 */
export function createOrgsRouter(deps: OrgsRouterDeps): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(createApiSuccessResponse(deps.admin.listOrgs()));
    }),
  );

  // Literal paths are declared before the parameterized ones so they can never
  // be captured as an org id.
  router.get(
    '/allowed-profiles',
    asyncHandler(async (req: Request, res: Response) => {
      const result = deps.policy.listAllowedProfiles(readProjectPath(req.query.project), {
        provider: readProvider(req.query.provider),
      });
      res.json(createApiSuccessResponse(result));
    }),
  );

  router.get(
    '/recommend',
    asyncHandler(async (req: Request, res: Response) => {
      const recommendation = await deps.recommend.recommend(
        readProjectPath(req.query.project),
        readProvider(req.query.provider),
      );
      res.json(createApiSuccessResponse(recommendation));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const org = deps.admin.createOrg(readBody(req.body));
      res.status(201).json(createApiSuccessResponse(org));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const org = deps.admin.updateOrg(readParam(req.params.id), readBody(req.body));
      res.json(createApiSuccessResponse(org));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      deps.admin.deleteOrg(readParam(req.params.id));
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/rules',
    asyncHandler(async (req: Request, res: Response) => {
      const rule = deps.admin.addRule(readParam(req.params.id), readBody(req.body));
      res.status(201).json(createApiSuccessResponse(rule));
    }),
  );

  router.delete(
    '/:id/rules/:ruleId',
    asyncHandler(async (req: Request, res: Response) => {
      deps.admin.deleteRule(readParam(req.params.id), readParam(req.params.ruleId));
      res.status(204).end();
    }),
  );

  router.put(
    '/:id/policies',
    asyncHandler(async (req: Request, res: Response) => {
      const policies = deps.admin.replacePolicies(readParam(req.params.id), req.body);
      res.json(createApiSuccessResponse(policies));
    }),
  );

  return router;
}
