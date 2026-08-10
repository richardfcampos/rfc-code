/**
 * HTTP surface for multi-account collaborations, mounted at
 * `/api/collaborations`.
 *
 * The router is deliberately thin: it reads path and query parameters, hands
 * the raw body to the service and wraps whatever comes back in the standard
 * envelope. Every rule about what a collaboration may contain lives in the
 * service, so the same rules apply no matter who calls it, and route tests can
 * drive the real surface with an injected fake engine — no account, no model
 * and no money involved.
 *
 * Construction is a factory for that reason: the services are supplied by the
 * module's composition root in production and by the tests everywhere else.
 */

import express from 'express';

import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { CollabServices } from './collab.service.js';

function readId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    throw new AppError('A collaboration id is required.', {
      code: 'COLLABORATION_ID_REQUIRED',
      statusCode: 400,
    });
  }
  return id;
}

export function createCollabRouter(services: CollabServices): express.Router {
  const router = express.Router();

  // Responds as soon as the row exists; the run itself continues in the
  // background and is followed through GET /:id.
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const collaboration = services.create(req.body);
      res.status(201).json(createApiSuccessResponse({ collaboration }));
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const collaborations = services.list(req.query.projectPath);
      res.json(createApiSuccessResponse({ collaborations }));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const collaboration = services.get(readId(req.params.id));
      res.json(createApiSuccessResponse({ collaboration }));
    }),
  );

  router.post(
    '/:id/stop',
    asyncHandler(async (req, res) => {
      const collaboration = services.stop(readId(req.params.id));
      res.json(createApiSuccessResponse({ collaboration }));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      services.remove(readId(req.params.id));
      res.json(createApiSuccessResponse({ deleted: true }));
    }),
  );

  return router;
}
