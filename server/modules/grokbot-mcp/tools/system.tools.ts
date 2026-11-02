/**
 * System-level tools: health, self-update, filesystem browsing, onboarding
 * state and `rfc_api_call`, the escape hatch for any `/api/*` route that has
 * no dedicated tool.
 */

import type { HttpMethod, JsonObject, RestRequest, ToolDefinition } from '../grokbot-mcp.types.js';

import { optObject, optStr, S, schema, str, tool, ToolInputError, LONG_RUNNING_TIMEOUT_MS } from './tool-helpers.js';

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function readMethod(args: JsonObject): HttpMethod {
  const method = str(args, 'method').toUpperCase();
  if (!HTTP_METHODS.includes(method as HttpMethod)) {
    throw new ToolInputError(`method must be one of ${HTTP_METHODS.join(', ')}.`);
  }
  return method as HttpMethod;
}

/**
 * The escape hatch is only meant for this server's own API; anything else
 * (or a path that climbs out of /api) would turn it into a generic proxy.
 */
function readApiPath(args: JsonObject): string {
  const path = str(args, 'path');
  if (/[?#\s]/.test(path) || !path.startsWith('/')) {
    throw new ToolInputError('path must be absolute, without query string (use query) or fragment.');
  }
  // The same normalisation fetch applies: `/api/%2e%2e/x` becomes `/x`, so the
  // check runs on the normalised pathname, never on the raw string.
  const normalised = new URL(path, 'http://loopback').pathname;
  if (!(normalised.startsWith('/api/') || normalised === '/health') || normalised.startsWith('/api/grokbot-mcp')) {
    throw new ToolInputError('path must be "/health" or start with "/api/" (and not call this endpoint itself).');
  }
  return normalised;
}

function readQuery(args: JsonObject): RestRequest['query'] {
  const raw = optObject(args, 'query');
  if (!raw) {
    return undefined;
  }
  const query: NonNullable<RestRequest['query']> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new ToolInputError(`query.${key} must be a string, number or boolean.`);
    }
    query[key] = value;
  }
  return query;
}

export const systemTools: ToolDefinition[] = [
  tool({
    name: 'health',
    description: 'Check that the RFC Code server is up. Returns the health payload; use it first to confirm connectivity.',
    inputSchema: schema({}),
    covers: ['GET /health'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/health' }),
  }),
  tool({
    name: 'system_update',
    description: 'Update the RFC Code installation to the latest version (runs the server self-update). Destructive for the running process: use only when the user asks for an update.',
    inputSchema: schema({}),
    covers: ['POST /api/system/update'],
    run: (_args, ctx) => ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: '/api/system/update' }),
  }),
  tool({
    name: 'filesystem_browse',
    description: 'List the sub-directories of a server directory, the same listing the new-project dialog shows. Defaults to the workspaces root when path is omitted.',
    inputSchema: schema({ path: S.string('Absolute or ~-prefixed directory path; omit for the workspaces root.') }),
    covers: ['GET /api/browse-filesystem'],
    run: (args, ctx) => {
      const path = optStr(args, 'path');
      return ctx.api.dispatch({ method: 'GET', path: '/api/browse-filesystem', query: path ? { path } : undefined });
    },
  }),
  tool({
    name: 'filesystem_create_folder',
    description: 'Create a directory on the server (including parents) inside the allowed workspaces root. Use before project_create when the folder does not exist yet.',
    inputSchema: schema({ path: S.string('Absolute or ~-prefixed path of the folder to create.') }, ['path']),
    covers: ['POST /api/create-folder'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: '/api/create-folder', body: { path: str(args, 'path') } }),
  }),
  tool({
    name: 'rfc_api_call',
    description: 'Escape hatch: call any RFC Code REST route (/api/* or /health) that has no dedicated tool. Prefer the dedicated tools; query and body are forwarded verbatim.',
    inputSchema: schema({
      method: S.enumOf(HTTP_METHODS, 'HTTP method.'),
      path: S.string('Route path starting with /api/ (or exactly /health), e.g. /api/settings/api-keys. No query string here.'),
      query: S.object('Query string parameters.'),
      body: { description: 'JSON request body (any JSON value).' },
    }, ['method', 'path']),
    covers: ['ALL /api/*'],
    run: (args, ctx) => ctx.api.dispatch({
      method: readMethod(args),
      path: readApiPath(args),
      query: readQuery(args),
      body: args.body,
    }),
  }),
  tool({
    name: 'auth_status',
    description: 'Report whether the instance needs first-time setup and whether authentication is enabled.',
    inputSchema: schema({}),
    covers: ['GET /api/auth/status'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/auth/status' }),
  }),
  tool({
    name: 'user_onboarding_status',
    description: 'Tell whether the current user has completed the first-run onboarding.',
    inputSchema: schema({}),
    covers: ['GET /api/user/onboarding-status'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/user/onboarding-status' }),
  }),
  tool({
    name: 'user_complete_onboarding',
    description: 'Mark the first-run onboarding as completed for the current user.',
    inputSchema: schema({}),
    covers: ['POST /api/user/complete-onboarding'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'POST', path: '/api/user/complete-onboarding' }),
  }),
];
