import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { MCP_SCOPES, optObject, optStr, pick, PROVIDERS, S, schema, seg, str, tool, ToolInputError } from './tool-helpers.js';

const PROVIDER = S.enumOf(PROVIDERS, 'Provider whose MCP configuration is managed.');
const SCOPE = S.enumOf(MCP_SCOPES, 'Where the server is stored: user (global), local (this workspace, private) or project (shared file).');
const WORKSPACE_PATH = S.string('Absolute workspace path; needed for the local and project scopes.');
const STRING_MAP = (description: string): JsonObject => ({ type: 'object', description, additionalProperties: { type: 'string' } });

const SERVER_FIELDS: Record<string, JsonObject> = {
  name: S.string('Server name (unique per scope).'),
  transport: S.enumOf(['stdio', 'http', 'sse'], 'stdio runs a local command; http and sse connect to a url.'),
  command: S.string('stdio: executable to run.'),
  args: S.stringArray('stdio: command arguments.'),
  env: STRING_MAP('stdio: environment variables for the process.'),
  cwd: S.string('stdio: working directory.'),
  url: S.string('http/sse: server URL.'),
  headers: STRING_MAP('http/sse: request headers.'),
  envVars: S.stringArray('codex: names of environment variables passed through to the server.'),
  bearerTokenEnvVar: S.string('codex http: environment variable holding the bearer token.'),
  envHttpHeaders: STRING_MAP('codex http: header name to environment variable name map.'),
};
const SERVER_BODY_KEYS = [...Object.keys(SERVER_FIELDS), 'scope', 'workspacePath'];

/** Validates only the container types; transport rules per provider are the server's call. */
function serverBody(args: JsonObject): JsonObject {
  str(args, 'name');
  str(args, 'transport');
  for (const key of ['scope', 'workspacePath', 'command', 'cwd', 'url', 'bearerTokenEnvVar']) {
    optStr(args, key);
  }
  for (const key of ['env', 'headers', 'envHttpHeaders']) {
    optObject(args, key);
  }
  for (const key of ['args', 'envVars']) {
    if (args[key] !== undefined && !Array.isArray(args[key])) {
      throw new ToolInputError(`${key} must be an array of strings.`);
    }
  }
  return pick(args, SERVER_BODY_KEYS);
}

export const mcpServerTools: ToolDefinition[] = [
  tool({
    name: 'mcp_server_list',
    description: 'List the MCP servers configured for a provider, optionally narrowed to one scope.',
    inputSchema: schema({ provider: PROVIDER, scope: SCOPE, workspacePath: WORKSPACE_PATH }, ['provider']),
    covers: ['GET /api/providers/:provider/mcp/servers'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'GET',
        path: `/api/providers/${seg(str(args, 'provider'))}/mcp/servers`,
        query: { scope: optStr(args, 'scope'), workspacePath: optStr(args, 'workspacePath') },
      }),
  }),
  tool({
    name: 'mcp_server_upsert',
    description: 'Add or replace one MCP server in a provider\'s configuration (stdio command or http/sse url).',
    inputSchema: schema(
      { provider: PROVIDER, scope: SCOPE, workspacePath: WORKSPACE_PATH, ...SERVER_FIELDS },
      ['provider', 'name', 'transport'],
    ),
    covers: ['POST /api/providers/:provider/mcp/servers'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST',
        path: `/api/providers/${seg(str(args, 'provider'))}/mcp/servers`,
        body: serverBody(args),
      }),
  }),
  tool({
    name: 'mcp_server_delete',
    description: 'Remove an MCP server from a provider\'s configuration.',
    inputSchema: schema(
      { provider: PROVIDER, name: S.string('Server name to remove.'), scope: SCOPE, workspacePath: WORKSPACE_PATH },
      ['provider', 'name'],
    ),
    covers: ['DELETE /api/providers/:provider/mcp/servers/:name'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'DELETE',
        path: `/api/providers/${seg(str(args, 'provider'))}/mcp/servers/${seg(str(args, 'name'))}`,
        query: { scope: optStr(args, 'scope'), workspacePath: optStr(args, 'workspacePath') },
      }),
  }),
  tool({
    name: 'mcp_server_add_global',
    description: 'Add the same MCP server to every provider at once. Only the user and project scopes are supported.',
    inputSchema: schema(
      {
        scope: S.enumOf(['user', 'project'], 'user (global) or project (needs workspacePath).'),
        workspacePath: WORKSPACE_PATH,
        ...SERVER_FIELDS,
      },
      ['name', 'transport'],
    ),
    covers: ['POST /api/providers/mcp/servers/global'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: '/api/providers/mcp/servers/global', body: serverBody(args) }),
  }),
];
