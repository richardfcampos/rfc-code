/**
 * HTTP surface of the Review Center, mounted at `/api/reviews`.
 *
 * The layer only parses the request and hands raw values to the service —
 * every field-level check, and every decision about what reaches git, lives
 * behind that boundary.
 */

import express from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import type { ReviewsService } from './reviews.service.js';

export function createReviewsRouter(service: ReviewsService): express.Router {
  const router = express.Router();

  // The queue: live reviews by default, joined with the columns a card shows.
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const reviews = service.listQueue({ state: req.query.state, project: req.query.project });
      res.json(createApiSuccessResponse({ reviews }));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(createApiSuccessResponse(await service.getDetail(req.params.id)));
    }),
  );

  router.get(
    '/:id/diff',
    asyncHandler(async (req, res) => {
      res.json(createApiSuccessResponse(await service.getFileDiff(req.params.id, req.query.file)));
    }),
  );

  router.post(
    '/:id/comments',
    asyncHandler(async (req, res) => {
      const result = await service.addComment(req.params.id, req.body as Record<string, unknown>);
      res.status(201).json(createApiSuccessResponse(result));
    }),
  );

  router.post(
    '/:id/approve',
    asyncHandler(async (req, res) => {
      const result = await service.approve(req.params.id, req.body as Record<string, unknown>);
      res.json(createApiSuccessResponse(result));
    }),
  );

  router.post(
    '/:id/request-changes',
    asyncHandler(async (req, res) => {
      const result = await service.requestChanges(
        req.params.id,
        req.body as Record<string, unknown>,
      );
      res.json(createApiSuccessResponse(result));
    }),
  );

  return router;
}
