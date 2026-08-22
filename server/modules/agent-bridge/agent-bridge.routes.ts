/**
 * REST surface of the Agent Bridge: `/api/agent-bridge`.
 *
 * Two routers with two different callers. The tools router is what an agent's
 * stdio MCP process talks to; it authenticates with a per-session bridge token
 * (agent processes hold no user JWT) and is therefore mounted outside
 * `authenticateToken`. The session-token router is the UI's way to mint that
 * credential and is mounted behind normal JWT auth like every other REST
 * surface — minting a token is a user action, using one is not.
 *
 * Handlers stay thin: input validation and business rules live in the tool
 * dispatch, and named errors bubble to the global error middleware, which maps
 * them via `AppError.statusCode`.
 */

import express, { type Request, type Response } from 'express';

import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

import { readBearerToken } from './agent-bridge-token.js';
import {
  AgentBridgeAuthError,
  AgentBridgeSessionGoneError,
  AgentBridgeValidationError,
} from './agent-bridge.errors.js';
import { runAgentBridgeTool } from './agent-bridge.tools.js';
import type {
  AgentBridgeRouterDeps,
  AgentBridgeSessionScope,
  AgentBridgeSessionTokenDeps,
} from './agent-bridge.types.js';

/** The scope the bearer middleware resolved, carried to the handler. */
interface ScopedRequest extends Request {
  agentBridgeScope?: AgentBridgeSessionScope;
}

/** Express types a route parameter as possibly repeated; only the first matters here. */
function readParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function readQueryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Builds the agent-facing tools router.
 *
 * Authentication is two-step by design: the signature proves the token was
 * minted here, and the session lookup proves the run it was minted for is
 * still alive. A token that outlives its session buys nothing.
 */
export function createAgentBridgeRouter(deps: AgentBridgeRouterDeps): express.Router {
  const router = express.Router();

  router.use((req: ScopedRequest, _res: Response, next) => {
    const token = readBearerToken(req.headers.authorization);
    if (!token) {
      throw new AgentBridgeAuthError('An agent bridge token is required.');
    }

    const payload = deps.verifyToken(token);
    if (!payload) {
      throw new AgentBridgeAuthError();
    }

    // The project comes from the session as it stands right now, not from the
    // signed copy in the token: a token can then only ever be as wide as the
    // session it names, even if that session's project changed since minting.
    const scope = deps.resolveSessionScope(payload.sessionId);
    if (!scope) {
      throw new AgentBridgeSessionGoneError(payload.sessionId);
    }

    req.agentBridgeScope = scope;
    next();
  });

  router.post(
    '/tools/:toolName',
    asyncHandler(async (req: ScopedRequest, res: Response) => {
      const scope = req.agentBridgeScope;
      if (!scope) {
        // Unreachable while the middleware above runs first; treated as a
        // refusal rather than a crash so a future mount order change cannot
        // turn into an unscoped call.
        throw new AgentBridgeAuthError();
      }

      const input = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const data = await runAgentBridgeTool(readParam(req.params.toolName), input, scope, deps);
      res.json(createApiSuccessResponse(data));
    }),
  );

  return router;
}

/**
 * Builds the UI-facing router that mints a session's bridge token and returns
 * the MCP registration that carries it.
 */
export function createAgentBridgeSessionTokenRouter(
  deps: AgentBridgeSessionTokenDeps,
): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = readQueryString(req.query.sessionId);
      if (!sessionId) {
        throw new AgentBridgeValidationError('sessionId is required.');
      }

      const scope = deps.resolveSessionScope(sessionId);
      if (!scope) {
        throw new AgentBridgeSessionGoneError(sessionId);
      }

      const token = deps.mintToken(scope);
      res.json(createApiSuccessResponse({
        sessionId: scope.sessionId,
        projectName: scope.projectName,
        projectPath: scope.projectPath,
        token,
        mcp: deps.describeRegistration(scope, token),
      }));
    }),
  );

  return router;
}
