/**
 * Every REST route the server mounts must be reachable through a dedicated
 * MCP tool, or be listed below with the reason it is not. The scan reads the
 * route files themselves, so a route added anywhere in the server fails this
 * test until a tool claims it — "the bot can do everything the UI can" is an
 * assertion here, not a promise.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { collectToolDefinitions } from '@/modules/grokbot-mcp/tools/index.js';

const SERVER_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Mount prefix → route files, mirroring the `app.use` lines of server/index.js. */
const MOUNTS: Record<string, string[]> = {
  '/api/auth': ['routes/auth.js'],
  '/api/projects': ['modules/projects/projects.routes.ts'],
  '/api/assets': ['modules/assets/assets.routes.ts'],
  '/api/git': ['routes/git.js', 'routes/git-compare.js'],
  '/api/worktrees': ['modules/worktrees/worktrees.routes.ts'],
  '/api/tasks': ['modules/tasks/tasks.routes.ts', 'modules/tasks/task-decomposition.routes.ts'],
  '/api/orgs': ['modules/orgs/orgs.routes.ts'],
  '/api/automations': ['modules/automations/automations.routes.ts'],
  '/api/reviews': ['modules/reviews/reviews.routes.ts'],
  '/api/agent-messages': ['modules/agent-messages/agent-messages.routes.ts'],
  '/api/team-view': ['modules/team-view/team-view.routes.ts'],
  '/api/cursor': ['routes/cursor.js'],
  '/api/taskmaster': ['routes/taskmaster.js'],
  '/api/mcp-utils': ['routes/mcp-utils.js'],
  '/api/commands': ['routes/commands.js'],
  '/api/settings': ['routes/settings.js'],
  '/api/notifications': ['modules/notifications/notifications.routes.ts'],
  '/api/user': ['routes/user.js'],
  '/api/plugins': ['routes/plugins.js'],
  '/api/preview': ['routes/preview.js'],
  '/api/browser-use': ['modules/browser-use/browser-use.routes.ts'],
  '/api/providers': ['modules/providers/provider.routes.ts'],
  '/api/profiles': ['modules/profiles/profiles.routes.ts'],
  '/api/collaborations': ['modules/collab/collab.routes.ts'],
};

/** Mounts whose whole surface is deliberately not a tool, with the reason. */
const EXCLUDED_MOUNTS: Record<string, string> = {
  '/api': 'the optional installation-wide API_KEY guard, not a router',
  '/api/agent-bridge/session-token': 'agent bridge: per-session HMAC token for agent processes, not a user action',
  '/api/agent-bridge': 'agent bridge: authenticates with its own session token',
  '/api/automations/webhook': 'inbound webhook: authenticates with the automation secret, not a user action',
  '/api/browser-use-mcp': 'browser MCP bridge: authenticates with its own local token',
  '/api/agent': 'external agent API: already an API-key surface of its own; reachable through rfc_api_call',
  '/api/voice': 'audio proxy for the browser microphone/speaker; nothing for a bot to drive',
  '/api/grokbot-mcp': 'this module',
};

/** Individual routes without a tool, with the reason. */
const EXCLUDED_ROUTES: Record<string, string> = {
  'POST /api/auth/register': 'the bot is already identified by its API key',
  'POST /api/auth/login': 'the bot is already identified by its API key',
  'POST /api/auth/logout': 'JWT sessions are per request on the loopback path; nothing to log out',
  'GET /api/auth/user': 'the owner of the key is implicit; rfc_api_call covers it',
  'POST /api/automations/:p': 'webhook router declared in the same file; its real path is /api/automations/webhook/:id (excluded mount)',
  'GET /api/plugins/:p/assets/*': 'static assets of a plugin UI; nothing for a bot',
  'GET /api/settings/push/vapid-public-key': 'Web Push needs a browser service worker',
  'POST /api/settings/push/subscribe': 'Web Push needs a browser service worker',
  'POST /api/settings/push/unsubscribe': 'Web Push needs a browser service worker',
};

const ROUTE_PATTERN = /(?:router|app)\.(get|post|put|patch|delete|all)\(\s*['"]([^'"]+)['"]/g;

function normalize(method: string, routePath: string): string {
  const generic = routePath.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':p').replace(/\/+$/, '') || '/';
  return `${method.toUpperCase()} ${generic}`;
}

function joinMount(prefix: string, routePath: string): string {
  const combined = `${prefix}${routePath === '/' ? '' : routePath}`;
  return combined.length > 0 ? combined : '/';
}

function scanFile(relativePath: string, prefix: string): string[] {
  const source = readFileSync(path.join(SERVER_ROOT, relativePath), 'utf8');
  const routes: string[] = [];
  for (const match of source.matchAll(ROUTE_PATTERN)) {
    const [, method, routePath] = match;
    routes.push(normalize(method!, joinMount(prefix, routePath!)));
  }
  return routes;
}

function scanInlineRoutes(): string[] {
  const source = readFileSync(path.join(SERVER_ROOT, 'index.js'), 'utf8');
  const routes: string[] = [];
  for (const match of source.matchAll(ROUTE_PATTERN)) {
    const [, method, routePath] = match;
    if (routePath!.startsWith('/api/') || routePath === '/health') {
      routes.push(normalize(method!, routePath!));
    }
  }
  return routes;
}

function scanMountedPrefixes(): string[] {
  const source = readFileSync(path.join(SERVER_ROOT, 'index.js'), 'utf8');
  return [...source.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]/g)].map((match) => match[1]!);
}

function allServerRoutes(): Set<string> {
  const routes = new Set<string>(scanInlineRoutes());
  for (const [prefix, files] of Object.entries(MOUNTS)) {
    for (const file of files) {
      scanFile(file, prefix).forEach((route) => routes.add(route));
    }
  }
  return routes;
}

/** Expands `ALL path` into every verb so a proxy tool counts for each. */
function expandCovers(covers: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const entry of covers) {
    if (entry === 'ALL /api/*') {
      continue; // the escape hatch must not make the test vacuous
    }
    const [method, routePath] = entry.split(' ', 2) as [string, string];
    const methods = method === 'ALL' ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ALL'] : [method];
    methods.forEach((verb) => expanded.add(normalize(verb, routePath)));
  }
  return expanded;
}

test('every mounted /api prefix is either scanned or explicitly excluded', () => {
  const unknown = scanMountedPrefixes().filter((prefix) => !(prefix in MOUNTS) && !(prefix in EXCLUDED_MOUNTS));
  assert.deepEqual(unknown, [], `Mounts without a scan entry: ${unknown.join(', ')}`);
});

test('every server route is covered by a tool or excluded with a reason', () => {
  const covered = expandCovers(collectToolDefinitions().flatMap((definition) => definition.covers));
  const missing = [...allServerRoutes()].filter((route) => !covered.has(route) && !(route in EXCLUDED_ROUTES)).sort();
  assert.deepEqual(missing, [], `Routes without a tool:\n${missing.join('\n')}`);
});

test('no tool claims a route the server does not have', () => {
  const routes = allServerRoutes();
  const phantom: string[] = [];
  for (const definition of collectToolDefinitions()) {
    for (const entry of definition.covers) {
      if (entry === 'ALL /api/*') {
        continue;
      }
      const [method, routePath] = entry.split(' ', 2) as [string, string];
      const candidates = method === 'ALL' ? ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] : [method];
      if (!candidates.some((verb) => routes.has(normalize(verb, routePath)))) {
        phantom.push(`${definition.name}: ${entry}`);
      }
    }
  }
  assert.deepEqual(phantom, [], `Tools covering unknown routes:\n${phantom.join('\n')}`);
});

test('excluded routes still exist, so the list does not rot', () => {
  const routes = allServerRoutes();
  const stale = Object.keys(EXCLUDED_ROUTES).filter((route) => !routes.has(route));
  assert.deepEqual(stale, [], `Excluded routes no longer present: ${stale.join(', ')}`);
});
