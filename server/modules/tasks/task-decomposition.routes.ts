/**
 * REST surface for task decomposition, mounted into the Tasks router.
 *
 * Kept in its own router rather than added to `tasks.routes.ts`: the paths hang
 * off `/:id/subtasks`, nothing here shares the multipart plumbing of the main
 * router, and composing the two keeps both files small. Handlers stay thin —
 * validation and rules live in the decomposition service, and its named errors
 * bubble to the global error middleware.
 */

import express, { type Request, type Response } from 'express';

import { broadcastTaskUpdate } from '@/modules/tasks/task-update-broadcast.js';
import type { TaskBroadcast } from '@/modules/tasks/tasks.routes.js';
import type { TaskDecompositionService } from '@/modules/tasks/services/task-decomposition.service.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

export function createTaskDecompositionRouter(
  service: TaskDecompositionService,
  broadcast: TaskBroadcast = broadcastTaskUpdate,
): express.Router {
  const router = express.Router();

  router.post(
    '/:id/subtasks',
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const decomposition = service.decompose(req.params.id, body);

      // Each subtask is a new card on the same board, and the parent's own card
      // now has children — open boards need both events to render the plan
      // without a refetch.
      for (const subtask of decomposition.subtasks) {
        broadcast(subtask, 'created');
      }
      broadcast(decomposition.parent, 'updated');

      res.status(201).json(createApiSuccessResponse(decomposition));
    }),
  );

  router.get(
    '/:id/subtasks',
    asyncHandler(async (req: Request, res: Response) => {
      res.json(createApiSuccessResponse(service.getDecomposition(req.params.id)));
    }),
  );

  router.get(
    '/:id/subtasks/ready',
    asyncHandler(async (req: Request, res: Response) => {
      res.json(createApiSuccessResponse({ ready: service.listReady(req.params.id) }));
    }),
  );

  return router;
}
