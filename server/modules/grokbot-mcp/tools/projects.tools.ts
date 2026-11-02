/** Project registry tools: list, create/clone, rename, flags, archive/delete and per-project status. */

import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optBool, optInt, optStr, PROJECT_ID, S, schema, seg, str, strArray, tool } from './tool-helpers.js';

const projectPath = (args: JsonObject, suffix = ''): string => `/api/projects/${seg(str(args, 'projectId'))}${suffix}`;
const projectOnly = schema({ projectId: PROJECT_ID }, ['projectId']);

export const projectTools: ToolDefinition[] = [
  tool({
    name: 'project_list',
    description: 'List active projects with their recent sessions. Use first to discover projectId values; pass skipSync to avoid re-scanning provider session folders.',
    inputSchema: schema({
      skipSync: S.boolean('Skip the session re-synchronisation for a faster response.'),
      sessionsLimit: S.integer('Max sessions returned per project.'),
      sessionsOffset: S.integer('Sessions to skip per project.'),
    }),
    covers: ['GET /api/projects'],
    run: (args, ctx) => {
      const sessionsLimit = optInt(args, 'sessionsLimit');
      const sessionsOffset = optInt(args, 'sessionsOffset');
      return ctx.api.dispatch({
        method: 'GET',
        path: '/api/projects',
        query: {
          ...(optBool(args, 'skipSync') && { skipSynchronization: '1' }),
          ...(sessionsLimit !== undefined && { sessionsLimit }),
          ...(sessionsOffset !== undefined && { sessionsOffset }),
        },
      });
    },
  }),
  tool({
    name: 'project_list_archived',
    description: 'List archived projects (hidden from project_list). Use to find a projectId to restore with project_restore.',
    inputSchema: schema({}),
    covers: ['GET /api/projects/archived'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/projects/archived' }),
  }),
  tool({
    name: 'project_create',
    description: 'Register an existing server directory as a project (re-activates it when it was archived). Create the folder first with filesystem_create_folder if needed.',
    inputSchema: schema({
      path: S.string('Absolute path of the project directory.'),
      customName: S.string('Display name; defaults to the folder name.'),
    }, ['path']),
    covers: ['POST /api/projects/create-project'],
    run: (args, ctx) => {
      const customName = optStr(args, 'customName');
      return ctx.api.dispatch({
        method: 'POST',
        path: '/api/projects/create-project',
        body: { path: str(args, 'path'), ...(customName !== undefined && { customName }) },
      });
    },
  }),
  tool({
    name: 'project_clone',
    description: 'Clone a GitHub repository into a new project and wait for it to finish. Returns the progress events; the last one is "complete" (with the project) or "error". Can take minutes.',
    inputSchema: schema({
      path: S.string('Absolute workspace directory to clone into.'),
      githubUrl: S.string('Repository URL to clone.'),
      githubTokenId: S.integer('Id of a stored GitHub token to authenticate with.'),
      newGithubToken: S.string('A GitHub token to use for this clone (not stored by this call).'),
    }, ['path', 'githubUrl']),
    covers: ['GET /api/projects/clone-progress'],
    run: (args, ctx) => {
      const githubTokenId = optInt(args, 'githubTokenId');
      const newGithubToken = optStr(args, 'newGithubToken');
      return ctx.api.dispatch({
        method: 'GET',
        path: '/api/projects/clone-progress',
        query: {
          path: str(args, 'path'),
          githubUrl: str(args, 'githubUrl'),
          ...(githubTokenId !== undefined && { githubTokenId }),
          ...(newGithubToken ? { newGithubToken } : {}),
        },
        responseType: 'sse',
        sseUntil: (event) => event.type === 'complete' || event.type === 'error',
        timeoutMs: 10 * 60 * 1000,
      });
    },
  }),
  tool({
    name: 'project_rename',
    description: 'Change the display name of a project (the folder on disk is untouched).',
    inputSchema: schema({ projectId: PROJECT_ID, displayName: S.string('New display name.') }, ['projectId', 'displayName']),
    covers: ['PUT /api/projects/:projectId/rename'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'PUT', path: projectPath(args, '/rename'), body: { displayName: str(args, 'displayName') } }),
  }),
  tool({
    name: 'project_toggle_star',
    description: 'Toggle the starred flag of a project. Returns the new isStarred value.',
    inputSchema: projectOnly,
    covers: ['POST /api/projects/:projectId/toggle-star'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: projectPath(args, '/toggle-star') }),
  }),
  tool({
    name: 'project_toggle_notify',
    description: 'Toggle notifications for a project. Returns the new notifyEnabled value.',
    inputSchema: projectOnly,
    covers: ['POST /api/projects/:projectId/toggle-notify'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: projectPath(args, '/toggle-notify') }),
  }),
  tool({
    name: 'project_archive',
    description: 'Archive a project: it disappears from project_list but nothing is deleted and project_restore brings it back.',
    inputSchema: projectOnly,
    covers: ['DELETE /api/projects/:projectId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: projectPath(args) }),
  }),
  tool({
    name: 'project_delete',
    description: 'Permanently delete a project record and its stored session transcripts (force delete). The folder itself stays on disk. Irreversible: prefer project_archive.',
    inputSchema: projectOnly,
    covers: ['DELETE /api/projects/:projectId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: projectPath(args), query: { force: true } }),
  }),
  tool({
    name: 'project_restore',
    description: 'Restore an archived project to the active list.',
    inputSchema: projectOnly,
    covers: ['POST /api/projects/:projectId/restore'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: projectPath(args, '/restore') }),
  }),
  tool({
    name: 'project_sessions',
    description: 'Page through the sessions of one project (newest first). Use to find a sessionId for chat or session tools.',
    inputSchema: schema({
      projectId: PROJECT_ID,
      limit: S.integer('Page size (server default 20).'),
      offset: S.integer('Sessions to skip (default 0).'),
    }, ['projectId']),
    covers: ['GET /api/projects/:projectId/sessions'],
    run: (args, ctx) => {
      const limit = optInt(args, 'limit');
      const offset = optInt(args, 'offset');
      return ctx.api.dispatch({
        method: 'GET',
        path: projectPath(args, '/sessions'),
        query: { ...(limit !== undefined && { limit }), ...(offset !== undefined && { offset }) },
      });
    },
  }),
  tool({
    name: 'project_taskmaster_status',
    description: 'Report whether TaskMaster is initialised in a project and its basic metadata.',
    inputSchema: projectOnly,
    covers: ['GET /api/projects/:projectId/taskmaster'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: projectPath(args, '/taskmaster') }),
  }),
  tool({
    name: 'project_codegraph_status',
    description: 'Report the CodeGraph index state (indexed or not, indexing in progress) of a project.',
    inputSchema: projectOnly,
    covers: ['GET /api/projects/:projectId/codegraph'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: projectPath(args, '/codegraph') }),
  }),
  tool({
    name: 'project_codegraph_init',
    description: 'Start CodeGraph indexing of a project in the background (returns immediately; poll project_codegraph_status).',
    inputSchema: projectOnly,
    covers: ['POST /api/projects/:projectId/codegraph/init'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: projectPath(args, '/codegraph/init') }),
  }),
  tool({
    name: 'project_migrate_legacy_stars',
    description: 'One-time migration: star the given project ids in the database (legacy browser-stored stars). Rarely needed.',
    inputSchema: schema({ projectIds: S.stringArray('Project ids to mark as starred.') }, ['projectIds']),
    covers: ['POST /api/projects/migrate-legacy-stars'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: '/api/projects/migrate-legacy-stars', body: { projectIds: strArray(args, 'projectIds') } }),
  }),
];
