/**
 * API-key authentication for the Grokbot MCP endpoint.
 *
 * Deliberately independent of AUTH_MODE / platform mode: this endpoint hands
 * an external bot the whole control plane, so a trusted-mode install must not
 * let it through unauthenticated the way it does for the browser UI.
 *
 * `Authorization: Bearer` wins over `x-api-key` because, when the optional
 * environment `API_KEY` gate on `/api` is enabled, `x-api-key` is already
 * spent on that shared secret and the per-user key can only travel as Bearer.
 */

import type { NextFunction, Request, Response } from 'express';

import { errorResponse, JSON_RPC_ERRORS } from './grokbot-mcp.jsonrpc.js';
import type { GrokbotUser } from './grokbot-mcp.types.js';

export type GrokbotAuthDeps = {
  validateApiKey(apiKey: string): GrokbotUser | undefined;
};

/** The user the API key resolved to, carried from the middleware to the handler. */
export interface GrokbotRequest extends Request {
  grokbotUser?: GrokbotUser;
}

const MISSING_KEY_MESSAGE = 'An API key is required. Create one in Settings > API Tokens.';
const INVALID_KEY_MESSAGE = 'Invalid or inactive API key.';

function readBearer(header: unknown): string {
  if (typeof header !== 'string') {
    return '';
  }
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? '';
}

function readApiKey(req: Request): string {
  const bearer = readBearer(req.headers.authorization);
  if (bearer) {
    return bearer;
  }
  const header = req.headers['x-api-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value.trim() : '';
}

function reject(res: Response, message: string): void {
  res.status(401).json(errorResponse(null, JSON_RPC_ERRORS.UNAUTHORIZED, message));
}

export function createGrokbotAuthMiddleware(deps: GrokbotAuthDeps) {
  return (req: GrokbotRequest, res: Response, next: NextFunction): void => {
    const apiKey = readApiKey(req);
    if (!apiKey) {
      reject(res, MISSING_KEY_MESSAGE);
      return;
    }
    // A throwing key store propagates to Express as an error, so it fails closed.
    const user = deps.validateApiKey(apiKey);
    if (!user) {
      reject(res, INVALID_KEY_MESSAGE);
      return;
    }
    req.grokbotUser = user;
    next();
  };
}
