/**
 * Streamable HTTP transport of the Grokbot MCP server, without SSE.
 *
 * Stateless by design: every POST carries a complete JSON-RPC message or
 * batch and is answered in the same response, so there is no session id to
 * issue and DELETE has nothing to end. Every protocol-level problem — bad
 * JSON, a non-JSON-RPC body, a crashing handler — is answered here as a
 * JSON-RPC error, because MCP clients parse the body, not the server's REST
 * error envelope.
 */

import express, { type NextFunction, type Request, type Response } from 'express';

import { createGrokbotAuthMiddleware, type GrokbotAuthDeps, type GrokbotRequest } from './grokbot-mcp.auth.js';
import { errorResponse, handleJsonRpcPayload, JSON_RPC_ERRORS, type ToolRegistry } from './grokbot-mcp.jsonrpc.js';
import type { GrokbotUser, ToolContext } from './grokbot-mcp.types.js';

export type GrokbotRouterDeps = GrokbotAuthDeps & {
  registry: ToolRegistry;
  createContext(user: GrokbotUser): ToolContext;
};

/** Same ceiling as the server-wide JSON parser, so mounting order never changes what fits. */
const BODY_LIMIT = '50mb';

function isBodyParseError(error: unknown): boolean {
  const record = error as { type?: string } | null;
  return error instanceof SyntaxError || record?.type === 'entity.parse.failed';
}

/**
 * Turns errors raised before or around the handler into JSON-RPC errors.
 * Exported because a body parser mounted ahead of this router (the server's
 * global one) fails before the router runs; the composition root mounts this
 * right after the router on the same path to catch that case too.
 */
export function grokbotJsonRpcErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (isBodyParseError(error)) {
    res.status(200).json(errorResponse(null, JSON_RPC_ERRORS.PARSE, 'Parse error: request body is not valid JSON.'));
    return;
  }
  // Anything else reached here before or around the handler, possibly before
  // auth: the detail goes to the log, the (maybe anonymous) caller gets nothing.
  console.error('[grokbot-mcp] request failed outside the JSON-RPC handler:', error);
  res.status(200).json(errorResponse(null, JSON_RPC_ERRORS.INTERNAL, 'Internal error'));
}

/**
 * A body parser leaves `{}` behind when nothing was parsed (no JSON content
 * type, empty body), which would otherwise read as a silent notification.
 */
function isJsonRpcPayload(body: unknown): boolean {
  if (Array.isArray(body)) {
    return true;
  }
  return body !== null && typeof body === 'object' && Object.keys(body).length > 0;
}

export function createGrokbotMcpRouter(deps: GrokbotRouterDeps): express.Router {
  const router = express.Router();

  // No-op when the server already parsed the body; lets the router stand alone otherwise.
  router.use(express.json({ limit: BODY_LIMIT }));
  router.use(createGrokbotAuthMiddleware(deps));

  router.post('/', async (req: GrokbotRequest, res: Response) => {
    if (!isJsonRpcPayload(req.body)) {
      res
        .status(200)
        .json(errorResponse(null, JSON_RPC_ERRORS.PARSE, 'Parse error: expected a JSON-RPC request or batch in an application/json body.'));
      return;
    }
    try {
      // The auth middleware guarantees the user is set before this handler runs.
      const ctx = deps.createContext(req.grokbotUser as GrokbotUser);
      const response = await handleJsonRpcPayload(req.body, deps.registry, ctx);
      if (response === null) {
        res.status(202).end();
        return;
      }
      res.status(200).json(response);
    } catch (error) {
      grokbotJsonRpcErrorHandler(error, req, res, () => undefined);
    }
  });

  router.get('/', (_req: Request, res: Response) => {
    res
      .status(405)
      .set('Allow', 'POST, DELETE')
      .json(errorResponse(null, JSON_RPC_ERRORS.METHOD_NOT_FOUND, 'Streamable HTTP without SSE: use POST.'));
  });

  router.delete('/', (_req: Request, res: Response) => {
    res.status(204).end();
  });

  router.use(grokbotJsonRpcErrorHandler);

  return router;
}
