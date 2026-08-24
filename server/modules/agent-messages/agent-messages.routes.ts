/**
 * REST surface for the handoff inbox: `/api/agent-messages`.
 *
 * Read-only on purpose. Mutating a handoff is an agent action and goes through
 * the agent bridge, where the acting session is proven by its bridge token;
 * over REST the caller is a *user*, so letting it POST would mean letting it
 * forge a message from any session. This surface exists so the UI can render
 * what the agents are saying to each other.
 *
 * Listing here never marks anything delivered — delivery is the recipient
 * pulling its own inbox, not a human opening a page.
 *
 * Mounted behind `authenticateToken` by the server entrypoint. Named errors
 * bubble to the global error middleware, which maps them via
 * `AppError.statusCode`.
 */

import express, { type Request, type Response } from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { AgentMessageValidationError } from './agent-messages.errors.js';
import type { AgentMessagesService } from './agent-messages.service.js';

function readQueryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createAgentMessagesRouter(service: AgentMessagesService): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = readQueryString(req.query.sessionId);
      if (!sessionId) {
        throw new AgentMessageValidationError('sessionId is required.');
      }

      const messages = service.list(sessionId, {
        box: req.query.box,
        state: req.query.state,
      });
      res.json(createApiSuccessResponse({ messages }));
    }),
  );

  return router;
}
