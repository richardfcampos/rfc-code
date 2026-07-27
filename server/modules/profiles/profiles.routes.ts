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
import { handoffService } from '@/modules/profiles/handoff.service.js';
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

const parseSessionId = (value: unknown): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  throw new AppError('Invalid session id.', {
    code: 'INVALID_SESSION_ID',
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

// PATCH /api/profiles/:id/tooling { cavemanMode?, rtkMode? }
// Each key is optional and `null` clears that level back to unconfigured; a key
// left out is untouched, so setting one level never resets the other.
router.patch(
  '/:id/tooling',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseProfileId(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const input: { cavemanMode?: unknown; rtkMode?: unknown } = {};
    if ('cavemanMode' in body) {
      input.cavemanMode = body.cavemanMode;
    }
    if ('rtkMode' in body) {
      input.rtkMode = body.rtkMode;
    }

    const profile = profilesService.updateToolingModes(id, input);
    res.json(createApiSuccessResponse({ profile }));
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

// PATCH /api/profiles/sessions/:sessionId/tooling { cavemanMode }
// Per-session override of the compression level; null clears it so the session
// follows its profile again. RTK has no session-level equivalent — it is a hook
// in the profile's settings.json that every session of that profile shares.
router.patch(
  '/sessions/:sessionId/tooling',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (!('cavemanMode' in body)) {
      throw new AppError('cavemanMode is required.', {
        code: 'CAVEMAN_MODE_REQUIRED',
        statusCode: 400,
      });
    }

    const session = profilesService.updateSessionCavemanMode(sessionId, body.cavemanMode);
    res.json(createApiSuccessResponse({ session }));
  }),
);

// POST /api/profiles/sessions/:sessionId/handoff { profileId }
// Switches the account serving an existing session (HUB-12 mid-session handoff).
router.post(
  '/sessions/:sessionId/handoff',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const targetProfileId = parseProfileId(body.profileId);
    const handoff = handoffService.switchSessionProfile(sessionId, targetProfileId);
    res.json(createApiSuccessResponse({ handoff }));
  }),
);

export default router;
