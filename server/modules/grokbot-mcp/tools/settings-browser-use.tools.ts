/** Browser (browser-use) runtime: enablement, install and live sessions. */

import type { ToolDefinition } from '../grokbot-mcp.types.js';

import { S, schema, seg, str, tool, LONG_RUNNING_TIMEOUT_MS } from './tool-helpers.js';
import { requiredBool } from './settings-notifications.tools.js';

const SESSION_ID = S.string('Browser session id, as returned by browser_use_sessions.');

export const settingsBrowserUseTools: ToolDefinition[] = [
  tool({
    name: 'browser_use_settings_get',
    description: 'Read the Browser (browser-use) feature settings, i.e. whether the agent-driven browser is enabled.',
    inputSchema: schema({}),
    covers: ['GET /api/browser-use/settings'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/browser-use/settings' }),
  }),
  tool({
    name: 'browser_use_settings_set',
    description: 'Enable or disable the Browser (browser-use) feature.',
    inputSchema: schema({ enabled: S.boolean('Whether the Browser feature is enabled.') }, ['enabled']),
    covers: ['PUT /api/browser-use/settings'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'PUT', path: '/api/browser-use/settings', body: { enabled: requiredBool(args, 'enabled') } }),
  }),
  tool({
    name: 'browser_use_status',
    description: 'Report the Browser runtime status: whether it is installed, which runtime (cloud/local) is used and any errors.',
    inputSchema: schema({}),
    covers: ['GET /api/browser-use/status'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/browser-use/status' }),
  }),
  tool({
    name: 'browser_use_install_runtime',
    description: 'Install the local Browser runtime (Playwright and Chromium). Slow; check browser_use_status afterwards.',
    inputSchema: schema({}),
    covers: ['POST /api/browser-use/runtime/install'],
    run: (_args, ctx) => ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: '/api/browser-use/runtime/install' }),
  }),
  tool({
    name: 'browser_use_sessions',
    description: 'List Browser sessions with their status (ready, stopped or unavailable).',
    inputSchema: schema({}),
    covers: ['GET /api/browser-use/sessions'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/browser-use/sessions' }),
  }),
  tool({
    name: 'browser_use_session_stop',
    description: 'Stop a running Browser session, closing its browser but keeping the session record.',
    inputSchema: schema({ sessionId: SESSION_ID }, ['sessionId']),
    covers: ['POST /api/browser-use/sessions/:sessionId/stop'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: `/api/browser-use/sessions/${seg(str(args, 'sessionId'))}/stop` }),
  }),
  tool({
    name: 'browser_use_session_delete',
    description: 'Delete a Browser session and its stored data permanently.',
    inputSchema: schema({ sessionId: SESSION_ID }, ['sessionId']),
    covers: ['DELETE /api/browser-use/sessions/:sessionId'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'DELETE', path: `/api/browser-use/sessions/${seg(str(args, 'sessionId'))}` }),
  }),
];
