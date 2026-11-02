/**
 * Public surface of the Grokbot MCP module.
 *
 * `grokbotMcpRoutes` is mounted by the server entrypoint at
 * `/api/grokbot-mcp`; `configureGrokbotMcpRuntime` hands it the listening
 * server, the JWT minter and the provider runtimes once they exist.
 */

export { configureGrokbotMcpRuntime, grokbotMcpErrorHandler, grokbotMcpRoutes } from './grokbot-mcp.module.js';
export type { GrokbotMcpRuntimeDeps } from './grokbot-mcp.module.js';
