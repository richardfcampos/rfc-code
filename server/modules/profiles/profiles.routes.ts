/**
 * REST surface for account profiles: `/api/profiles`.
 *
 * Thin controllers only — validation of untrusted input and all business rules
 * live in `profilesService`; these handlers translate HTTP to service calls and
 * wrap results in the shared success envelope. Errors bubble as `AppError` and
 * are mapped to status codes by the global error middleware.
 */

import express, { type Request, type Response } from 'express';

import {
  assertSupportedProvider,
  profilesService,
} from '@/modules/profiles/profiles.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

const parseProfileId = (value: unknown): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  throw new AppError('Invalid profile id.', {
    code: 'INVALID_PROFILE_ID',
    statusCode: 400,
  });
};

// GET /api/profiles[?provider=claude]
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const rawProvider = typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
    const provider = rawProvider ? assertSupportedProvider(rawProvider) : undefined;
    const profiles = profilesService.listProfiles(provider);
    res.json(createApiSuccessResponse({ profiles }));
  }),
);

// POST /api/profiles { provider, name }
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const profile = profilesService.createProfile({
      provider: body.provider,
      name: body.name,
    });
    res.status(201).json(createApiSuccessResponse({ profile }));
  }),
);

// GET /api/profiles/:id/status
router.get(
  '/:id/status',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseProfileId(req.params.id);
    const status = profilesService.getAuthStatus(id);
    res.json(createApiSuccessResponse({ status }));
  }),
);

// DELETE /api/profiles/:id
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseProfileId(req.params.id);
    profilesService.deleteProfile(id);
    res.json(createApiSuccessResponse({ deleted: true }));
  }),
);

export default router;
