/**
 * REST surface for the native task board: `/api/tasks`.
 *
 * Thin controllers only — validation of untrusted input and all business
 * rules live in `tasksService`; these handlers translate HTTP to service
 * calls and wrap results in the shared success envelope. Named errors thrown
 * by the service (`TaskValidationError`, `TaskNotFoundError`) bubble to the
 * global error middleware, which maps them via `AppError.statusCode`.
 */

import express, { type Request, type Response } from 'express';

import type { TaskRow } from '@/modules/database/index.js';
import { broadcastTaskUpdate, type TaskUpdateAction } from '@/modules/tasks/task-update-broadcast.js';
import type { TasksService } from '@/modules/tasks/tasks.service.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

export type TaskBroadcast = (task: TaskRow, action: TaskUpdateAction) => void;

/**
 * Builds the Tasks HTTP router around an injected application-service API.
 *
 * `broadcast` defaults to the real WebSocket fan-out but is overridable so
 * route tests can assert broadcast behavior without a live socket.
 */
export function createTasksRouter(
  service: TasksService,
  broadcast: TaskBroadcast = broadcastTaskUpdate,
): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const tasks = await service.listTasks(req.query.project);
      res.json(createApiSuccessResponse({ tasks }));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const task = await service.createTask(body);
      broadcast(task, 'created');
      res.status(201).json(createApiSuccessResponse({ task }));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const task = await service.updateTask(req.params.id, body);
      broadcast(task, 'updated');
      res.json(createApiSuccessResponse({ task }));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const task = await service.deleteTask(req.params.id);
      broadcast(task, 'deleted');
      res.json(createApiSuccessResponse({ task }));
    }),
  );

  return router;
}
