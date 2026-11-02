/**
 * Composition root of the Grokbot MCP module.
 *
 * Binds the transport, the registry and the three execution paths to the real
 * installation. Everything that lives outside the module boundary (the user
 * JWT minting, the provider runtimes, the listening server) is handed in by
 * the entrypoint through `configureGrokbotMcpRuntime`, so the router can be
 * mounted at import time while the runtimes only exist after boot.
 */

import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { apiKeysDb, projectsDb, sessionsDb } from '@/modules/database/index.js';

import { createChatGateway, type ChatGatewayDeps } from './chat-gateway.js';
import { createGrokbotMcpRouter, grokbotJsonRpcErrorHandler } from './grokbot-mcp.routes.js';
import { createRestDispatcher } from './rest-dispatcher.js';
import { createShellRunner } from './shell-exec.js';
import { createToolRegistry } from './tools/index.js';
import type { ChatGateway, GrokbotUser, ToolContext } from './grokbot-mcp.types.js';

export type GrokbotMcpRuntimeDeps = {
  /** The listening HTTP server; its bound address is where loopback calls go. */
  server: HttpServer;
  /** Issues the JWT the REST layer expects for this user (`generateToken` of the auth middleware). */
  mintToken(user: GrokbotUser): string;
  spawnFns: ChatGatewayDeps['spawnFns'];
  abortFns: ChatGatewayDeps['abortFns'];
  resolveToolApproval: ChatGatewayDeps['resolveToolApproval'];
  getPendingApprovalsForSession: ChatGatewayDeps['getPendingApprovalsForSession'];
};

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '']);

/** Address the server is actually bound to; a wildcard bind is reached through loopback. */
export function resolveLoopbackBaseUrl(server: HttpServer): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Grokbot MCP: the HTTP server is not listening yet.');
  }
  const { address: host, port, family } = address as AddressInfo;
  if (WILDCARD_HOSTS.has(host)) {
    return `http://127.0.0.1:${port}`;
  }
  return family === 'IPv6' ? `http://[${host}]:${port}` : `http://${host}:${port}`;
}

let runtime: GrokbotMcpRuntimeDeps | null = null;
let chatGateway: ChatGateway | null = null;
const shellRunner = createShellRunner();
const registry = createToolRegistry();

function requireRuntime(): GrokbotMcpRuntimeDeps {
  if (!runtime) {
    throw new Error('Grokbot MCP runtime is not configured yet.');
  }
  return runtime;
}

function createContext(user: GrokbotUser): ToolContext {
  const deps = requireRuntime();
  if (!chatGateway) {
    chatGateway = createChatGateway({
      spawnFns: deps.spawnFns,
      abortFns: deps.abortFns,
      resolveToolApproval: deps.resolveToolApproval,
      getPendingApprovalsForSession: deps.getPendingApprovalsForSession,
      getSession: (sessionId) => sessionsDb.getSessionById(sessionId),
    });
  }
  const api = createRestDispatcher({
    resolveBaseUrl: () => resolveLoopbackBaseUrl(deps.server),
    mintToken: () => deps.mintToken(user),
    // The optional installation-wide key on `/api` is enforced before any
    // route; a loopback call has to present it like a browser would.
    extraHeaders: () => (process.env.API_KEY ? { 'x-api-key': process.env.API_KEY } : {}),
  });
  return {
    api,
    chat: chatGateway,
    shell: shellRunner,
    user,
    resolveProjectPath: async (projectId) => (await projectsDb.getProjectPathById(projectId)) ?? null,
  };
}

/** Called once by the entrypoint after `server.listen`. */
export function configureGrokbotMcpRuntime(deps: GrokbotMcpRuntimeDeps): void {
  runtime = deps;
  chatGateway = null;
}

/**
 * Mounted by the entrypoint at `/api/grokbot-mcp`, outside the user JWT
 * middleware, together with `grokbotMcpErrorHandler` so a body the global JSON
 * parser rejects still comes back as a JSON-RPC parse error.
 */
export const grokbotMcpErrorHandler = grokbotJsonRpcErrorHandler;

export const grokbotMcpRoutes = createGrokbotMcpRouter({
  validateApiKey: (apiKey) => {
    const user = apiKeysDb.validateApiKey(apiKey);
    return user ? { id: user.id, username: user.username } : undefined;
  },
  registry,
  createContext,
});
