/**
 * REST surface for the Team View aggregation: `/api/team-view`.
 *
 * Single read-only endpoint — no params, no body, no mutation. Mounted behind
 * `authenticateToken` by the server entrypoint, same as every other module.
 */

import express, { type Request, type Response } from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { TeamViewService } from './team-view.types.js';

export function createTeamViewRouter(service: TeamViewService): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const snapshot = await service.getSnapshot();
      res.json(createApiSuccessResponse(snapshot));
    }),
  );

  return router;
}
