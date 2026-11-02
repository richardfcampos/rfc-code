/** Session tools over REST: create, list, rename, archive/delete, history, search, model and profile changes. */

import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optInt, optStr, PROJECT_ID, PROVIDERS, S, schema, seg, str, tool, ToolInputError } from './tool-helpers.js';

const CAVEMAN_MODES = ['off', 'lite', 'full', 'ultra'] as const;

const SESSION_ID = S.string('Session id, as returned by project_sessions or session_create.');
const sessionOnly = schema({ sessionId: SESSION_ID }, ['sessionId']);
const sessionPath = (args: JsonObject, suffix = ''): string => `/api/providers/sessions/${seg(str(args, 'sessionId'))}${suffix}`;

export const sessionTools: ToolDefinition[] = [
  tool({
    name: 'session_create',
    description: 'Allocate a new empty chat session for a provider in a project directory. Returns the sessionId to use with session_send.',
    inputSchema: schema({
      provider: S.enumOf(PROVIDERS, 'Agent provider.'),
      projectPath: S.string('Absolute path of the project directory the session works in.'),
      profileId: S.string('Provider profile to bind the session to; omit for the default account.'),
    }, ['provider', 'projectPath']),
    covers: ['POST /api/providers/sessions'],
    run: (args, ctx) => {
      const profileId = optStr(args, 'profileId');
      return ctx.api.dispatch({
        method: 'POST',
        path: '/api/providers/sessions',
        body: { provider: str(args, 'provider'), projectPath: str(args, 'projectPath'), ...(profileId ? { profileId } : {}) },
      });
    },
  }),
  tool({
    name: 'session_list_running',
    description: 'List the sessions that currently have an agent run in progress, across all projects.',
    inputSchema: schema({}),
    covers: ['GET /api/providers/sessions/running'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/providers/sessions/running' }),
  }),
  tool({
    name: 'session_list_archived',
    description: 'List archived sessions (hidden from project listings). Use to find a sessionId for session_restore.',
    inputSchema: schema({}),
    covers: ['GET /api/providers/sessions/archived'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/providers/sessions/archived' }),
  }),
  tool({
    name: 'session_rename',
    description: 'Set the title (summary, max 500 chars) of a session and optionally link it to a task. taskId null detaches the task; omit taskId to leave it unchanged.',
    inputSchema: schema({
      sessionId: SESSION_ID,
      summary: S.string('New session title.'),
      taskId: { type: ['string', 'null'], description: 'Task id to link; null clears the link; omit to keep it.' },
    }, ['sessionId', 'summary']),
    covers: ['PUT /api/providers/sessions/:sessionId'],
    run: (args, ctx) => {
      const body: JsonObject = { summary: str(args, 'summary') };
      if (args.taskId !== undefined) {
        if (args.taskId !== null && typeof args.taskId !== 'string') {
          throw new ToolInputError('taskId must be a string or null.');
        }
        body.taskId = args.taskId;
      }
      return ctx.api.dispatch({ method: 'PUT', path: sessionPath(args), body });
    },
  }),
  tool({
    name: 'session_archive',
    description: 'Archive a session: hidden from listings, transcript kept, reversible with session_restore.',
    inputSchema: sessionOnly,
    covers: ['DELETE /api/providers/sessions/:sessionId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: sessionPath(args) }),
  }),
  tool({
    name: 'session_delete',
    description: 'Permanently delete a session and its transcript from disk (force delete). Irreversible: prefer session_archive.',
    inputSchema: sessionOnly,
    covers: ['DELETE /api/providers/sessions/:sessionId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: sessionPath(args), query: { force: true } }),
  }),
  tool({
    name: 'session_restore',
    description: 'Restore an archived session to its project listing.',
    inputSchema: sessionOnly,
    covers: ['POST /api/providers/sessions/:sessionId/restore'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: sessionPath(args, '/restore') }),
  }),
  tool({
    name: 'session_messages',
    description: 'Read the message history of a session, normalised across providers. Page with limit and offset; omit limit for everything.',
    inputSchema: schema({
      sessionId: SESSION_ID,
      limit: S.integer('Max messages to return.'),
      offset: S.integer('Messages to skip from the start.'),
    }, ['sessionId']),
    covers: ['GET /api/providers/sessions/:sessionId/messages'],
    run: (args, ctx) => {
      const limit = optInt(args, 'limit');
      const offset = optInt(args, 'offset');
      return ctx.api.dispatch({
        method: 'GET',
        path: sessionPath(args, '/messages'),
        query: { ...(limit !== undefined && { limit }), ...(offset !== undefined && { offset }) },
      });
    },
  }),
  tool({
    name: 'session_token_usage',
    description: 'Report the token usage and context window fill of a session within its project.',
    inputSchema: schema({ projectId: PROJECT_ID, sessionId: SESSION_ID }, ['projectId', 'sessionId']),
    covers: ['GET /api/projects/:projectId/sessions/:sessionId/token-usage'],
    run: (args, ctx) => ctx.api.dispatch({
      method: 'GET',
      path: `/api/projects/${seg(str(args, 'projectId'))}/sessions/${seg(str(args, 'sessionId'))}/token-usage`,
    }),
  }),
  tool({
    name: 'session_search',
    description: 'Full-text search across all conversations. Waits for the scan to finish and returns the streamed events (progress, result per project, then done).',
    inputSchema: schema({
      q: S.string('Search text, at least 2 characters.'),
      limit: S.integer('Max matches (server default 50).'),
    }, ['q']),
    covers: ['GET /api/providers/search/sessions'],
    run: (args, ctx) => {
      const limit = optInt(args, 'limit');
      return ctx.api.dispatch({
        method: 'GET',
        path: '/api/providers/search/sessions',
        query: { q: str(args, 'q'), ...(limit !== undefined && { limit }) },
        responseType: 'sse',
        sseUntil: (event) => event.event === 'done' || event.event === 'error',
      });
    },
  }),
  tool({
    name: 'session_set_active_model',
    description: 'Switch the model a session uses for its next turns. List valid models with provider_models.',
    inputSchema: schema({
      provider: S.enumOf(PROVIDERS, 'Provider owning the session.'),
      sessionId: SESSION_ID,
      model: S.string('Model id.'),
    }, ['provider', 'sessionId', 'model']),
    covers: ['POST /api/providers/:provider/sessions/:sessionId/active-model'],
    run: (args, ctx) => ctx.api.dispatch({
      method: 'POST',
      path: `/api/providers/${seg(str(args, 'provider'))}/sessions/${seg(str(args, 'sessionId'))}/active-model`,
      body: { model: str(args, 'model') },
    }),
  }),
  tool({
    name: 'session_set_caveman_mode',
    description: 'Set the terse-output ("caveman") mode of one session: off, lite, full or ultra. null resets it to the profile default.',
    inputSchema: schema({
      sessionId: SESSION_ID,
      cavemanMode: { type: ['string', 'null'], enum: [...CAVEMAN_MODES, null], description: 'off | lite | full | ultra, or null to inherit.' },
    }, ['sessionId', 'cavemanMode']),
    covers: ['PATCH /api/profiles/sessions/:sessionId/tooling'],
    run: (args, ctx) => {
      // The server insists the key exists, so null must be sent explicitly.
      const mode = args.cavemanMode;
      if (mode !== null && !(typeof mode === 'string' && (CAVEMAN_MODES as readonly string[]).includes(mode))) {
        throw new ToolInputError(`cavemanMode must be one of ${CAVEMAN_MODES.join(', ')} or null.`);
      }
      return ctx.api.dispatch({
        method: 'PATCH',
        path: `/api/profiles/sessions/${seg(str(args, 'sessionId'))}/tooling`,
        body: { cavemanMode: mode },
      });
    },
  }),
  tool({
    name: 'session_handoff_profile',
    description: 'Hand a session over to another provider profile (account), carrying the conversation across. Returns the resulting session.',
    inputSchema: schema({ sessionId: SESSION_ID, profileId: S.string('Target profile id, from profile_list.') }, ['sessionId', 'profileId']),
    covers: ['POST /api/profiles/sessions/:sessionId/handoff'],
    run: (args, ctx) => ctx.api.dispatch({
      method: 'POST',
      path: `/api/profiles/sessions/${seg(str(args, 'sessionId'))}/handoff`,
      body: { profileId: str(args, 'profileId') },
    }),
  }),
];
