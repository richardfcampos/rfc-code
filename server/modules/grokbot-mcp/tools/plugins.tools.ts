import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optBool, S, schema, seg, str, tool, ToolInputError, LONG_RUNNING_TIMEOUT_MS } from './tool-helpers.js';

const PLUGIN_NAME = S.string('Plugin name, as returned by plugin_list.');
const RPC_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function pluginPath(args: JsonObject, suffix = ''): string {
  return `/api/plugins/${seg(str(args, 'name'))}${suffix}`;
}

/**
 * Splits the client path into encoded segments plus an optional query string.
 * Dot segments are refused so a plugin call can never be steered at another route.
 */
function parseRpcPath(raw: string): { path: string; query?: Record<string, string> } {
  const [pathPart, ...rest] = raw.split('?');
  const segments = pathPart.split('/').filter((entry) => entry !== '');
  if (segments.some((entry) => entry === '.' || entry === '..')) {
    throw new ToolInputError('path must not contain "." or ".." segments.');
  }
  const queryString = rest.join('?');
  return {
    path: segments.map(seg).join('/'),
    query: queryString ? Object.fromEntries(new URLSearchParams(queryString)) : undefined,
  };
}

export const pluginTools: ToolDefinition[] = [
  tool({
    name: 'plugin_list',
    description: 'List installed UI plugins with their enabled flag and whether their server process is running.',
    inputSchema: schema({}),
    covers: ['GET /api/plugins'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/plugins' }),
  }),
  tool({
    name: 'plugin_manifest',
    description: 'Read the manifest of one installed plugin (name, version, entry, server settings).',
    inputSchema: schema({ name: PLUGIN_NAME }, ['name']),
    covers: ['GET /api/plugins/:name/manifest'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: pluginPath(args, '/manifest') }),
  }),
  tool({
    name: 'plugin_install',
    description: 'Install a plugin from a git repository URL. The code is cloned and, if enabled, may run a local server process; only install sources you trust.',
    inputSchema: schema({ url: S.string('Git repository URL of the plugin.') }, ['url']),
    covers: ['POST /api/plugins/install'],
    run: (args, ctx) => ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: '/api/plugins/install', body: { url: str(args, 'url') } }),
  }),
  tool({
    name: 'plugin_update',
    description: 'Pull the latest version of an installed plugin from its git source.',
    inputSchema: schema({ name: PLUGIN_NAME }, ['name']),
    covers: ['POST /api/plugins/:name/update'],
    run: (args, ctx) => ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: pluginPath(args, '/update') }),
  }),
  tool({
    name: 'plugin_enable',
    description: 'Enable or disable an installed plugin.',
    inputSchema: schema({ name: PLUGIN_NAME, enabled: S.boolean('True to enable, false to disable.') }, ['name', 'enabled']),
    covers: ['PUT /api/plugins/:name/enable'],
    run: (args, ctx) => {
      const enabled = optBool(args, 'enabled');
      if (enabled === undefined) {
        throw new ToolInputError('enabled is required.');
      }
      return ctx.api.dispatch({ method: 'PUT', path: pluginPath(args, '/enable'), body: { enabled } });
    },
  }),
  tool({
    name: 'plugin_uninstall',
    description: 'Uninstall a plugin: stops its server process and deletes its files.',
    inputSchema: schema({ name: PLUGIN_NAME }, ['name']),
    covers: ['DELETE /api/plugins/:name'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: pluginPath(args) }),
  }),
  tool({
    name: 'plugin_rpc',
    description:
      'Call an endpoint on a plugin\'s own server through the proxy. The path is appended after /api/plugins/<name>/rpc/ (leading slash optional, query string allowed); the available endpoints are defined by the plugin.',
    inputSchema: schema(
      {
        name: PLUGIN_NAME,
        method: S.enumOf(RPC_METHODS, 'HTTP method to use against the plugin server.'),
        path: S.string('Plugin-defined path, e.g. "items" or "/items?limit=5".'),
        body: S.object('JSON body to forward (POST, PUT, PATCH, DELETE).'),
      },
      ['name', 'method', 'path'],
    ),
    covers: ['ALL /api/plugins/:name/rpc/*'],
    run: (args, ctx) => {
      const method = str(args, 'method').toUpperCase();
      if (!(RPC_METHODS as readonly string[]).includes(method)) {
        throw new ToolInputError(`method must be one of: ${RPC_METHODS.join(', ')}.`);
      }
      const target = parseRpcPath(str(args, 'path'));
      return ctx.api.dispatch({
        method: method as (typeof RPC_METHODS)[number],
        path: pluginPath(args, `/rpc/${target.path}`),
        query: target.query,
        body: args.body,
      });
    },
  }),
];
