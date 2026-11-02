/** UAT preview: boot recipe and lifecycle of a project's dev server. */

import type { ToolDefinition } from '../grokbot-mcp.types.js';

import { PROJECT_ID, S, optStr, pick, schema, seg, str, tool } from './tool-helpers.js';

const CWD = S.string('Working directory (a worktree path inside the project). Defaults to the project root.');

export const previewTools: ToolDefinition[] = [
  tool({
    name: 'preview_config_get',
    description: 'Read the saved UAT preview boot recipe (command, setup command, bind host, port) of a project.',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['GET /api/preview/config/:projectId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: `/api/preview/config/${seg(str(args, 'projectId'))}` }),
  }),
  tool({
    name: 'preview_config_set',
    description: 'Save the UAT preview boot recipe of a project. bindHost cannot be a wildcard address (0.0.0.0).',
    inputSchema: schema(
      {
        projectId: PROJECT_ID,
        command: S.string('Command that starts the dev server.'),
        setupCommand: S.string('Optional command run once before the start command (e.g. install).'),
        bindHost: S.string('Host the server binds to; wildcard addresses are rejected.'),
        port: S.integer('Port, 1-65535.'),
      },
      ['projectId', 'command'],
    ),
    covers: ['PUT /api/preview/config/:projectId'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'PUT',
        path: `/api/preview/config/${seg(str(args, 'projectId'))}`,
        body: { command: str(args, 'command'), ...pick(args, ['setupCommand', 'bindHost', 'port']) },
      }),
  }),
  tool({
    name: 'preview_start',
    description: 'Boot the UAT preview of a project (or of one of its worktrees via cwd). Poll preview_status for the URL and state.',
    inputSchema: schema({ projectId: PROJECT_ID, cwd: CWD }, ['projectId']),
    covers: ['POST /api/preview/start/:projectId'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: `/api/preview/start/${seg(str(args, 'projectId'))}`, body: pick(args, ['cwd']) }),
  }),
  tool({
    name: 'preview_status',
    description: 'State of a project preview: starting, running or stopped, with its URL and recent output.',
    inputSchema: schema({ projectId: PROJECT_ID, cwd: CWD }, ['projectId']),
    covers: ['GET /api/preview/status/:projectId'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'GET',
        path: `/api/preview/status/${seg(str(args, 'projectId'))}`,
        query: { cwd: optStr(args, 'cwd') },
      }),
  }),
  tool({
    name: 'preview_stop',
    description: 'Stop the running UAT preview of a project (or of the worktree given by cwd).',
    inputSchema: schema({ projectId: PROJECT_ID, cwd: CWD }, ['projectId']),
    covers: ['POST /api/preview/stop/:projectId'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: `/api/preview/stop/${seg(str(args, 'projectId'))}`, body: pick(args, ['cwd']) }),
  }),
];
