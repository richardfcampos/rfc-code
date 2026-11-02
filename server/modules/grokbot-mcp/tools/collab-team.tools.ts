/** Multi-agent collaborations, the team view and agent-to-agent messages. */

import type { ToolDefinition } from '../grokbot-mcp.types.js';

import { S, ToolInputError, optObject, optStr, pick, schema, seg, str, tool } from './tool-helpers.js';

const COLLAB_MODES = ['debate', 'review', 'vote', 'council'] as const;
const MESSAGE_BOXES = ['inbox', 'outbox'] as const;
const MESSAGE_STATES = ['queued', 'delivered', 'acknowledged', 'answered', 'failed'] as const;
const COLLAB_ID = S.string('Collaboration id, as returned by collab_list or collab_create.');

const PARTICIPANT = {
  type: 'object',
  properties: {
    profileId: S.string('Provider profile id (see profile_list).'),
    role: S.string('Role the participant plays in the discussion.'),
    model: S.string('Model override.'),
    effort: S.string('Reasoning effort override.'),
  },
  required: ['profileId'],
  additionalProperties: false,
};

export const collabTeamTools: ToolDefinition[] = [
  tool({
    name: 'collab_list',
    description: 'List multi-agent collaborations (debate, review, vote, council), optionally only those of one project path.',
    inputSchema: schema({ projectPath: S.string('Absolute project path to filter by.') }),
    covers: ['GET /api/collaborations'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'GET', path: '/api/collaborations', query: { projectPath: optStr(args, 'projectPath') } }),
  }),
  tool({
    name: 'collab_create',
    description:
      'Start a collaboration where 2 to 4 agent profiles discuss a topic. Returns immediately; follow progress with collab_get.',
    inputSchema: schema(
      {
        topic: S.string('Question or subject for the participants.'),
        projectPath: S.string('Absolute path of the project the agents work in.'),
        mode: S.enumOf(COLLAB_MODES, 'Collaboration mode.'),
        participants: S.array(PARTICIPANT, 'Two to four participants.'),
        maxRounds: S.integer('Maximum discussion rounds.'),
        budget: S.object('Optional budget limits object.'),
      },
      ['topic', 'projectPath', 'mode', 'participants'],
    ),
    covers: ['POST /api/collaborations'],
    run: (args, ctx) => {
      if (!Array.isArray(args.participants) || args.participants.length === 0) {
        throw new ToolInputError('participants must be a non-empty array.');
      }
      const budget = optObject(args, 'budget');
      return ctx.api.dispatch({
        method: 'POST',
        path: '/api/collaborations',
        body: {
          topic: str(args, 'topic'),
          projectPath: str(args, 'projectPath'),
          mode: str(args, 'mode'),
          participants: args.participants,
          ...pick(args, ['maxRounds']),
          ...(budget ? { budget } : {}),
        },
      });
    },
  }),
  tool({
    name: 'collab_get',
    description: 'Read one collaboration with its turns, status and outcome.',
    inputSchema: schema({ collaborationId: COLLAB_ID }, ['collaborationId']),
    covers: ['GET /api/collaborations/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: `/api/collaborations/${seg(str(args, 'collaborationId'))}` }),
  }),
  tool({
    name: 'collab_stop',
    description: 'Stop a running collaboration; its turns so far are kept.',
    inputSchema: schema({ collaborationId: COLLAB_ID }, ['collaborationId']),
    covers: ['POST /api/collaborations/:id/stop'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'POST', path: `/api/collaborations/${seg(str(args, 'collaborationId'))}/stop` }),
  }),
  tool({
    name: 'collab_delete',
    description: 'Delete a collaboration and its turns permanently.',
    inputSchema: schema({ collaborationId: COLLAB_ID }, ['collaborationId']),
    covers: ['DELETE /api/collaborations/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: `/api/collaborations/${seg(str(args, 'collaborationId'))}` }),
  }),
  tool({
    name: 'team_view',
    description: 'Snapshot of running and idle agent sessions with their profile, task, usage and the delegation edges between them.',
    inputSchema: schema({}),
    covers: ['GET /api/team-view'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/team-view' }),
  }),
  tool({
    name: 'agent_message_list',
    description: 'List agent-to-agent messages of a session, optionally only its inbox or outbox and/or one delivery state.',
    inputSchema: schema(
      {
        sessionId: S.string('Session id whose messages to list.'),
        box: S.enumOf(MESSAGE_BOXES, 'Inbox (received) or outbox (sent).'),
        state: S.enumOf(MESSAGE_STATES, 'Delivery state filter.'),
      },
      ['sessionId'],
    ),
    covers: ['GET /api/agent-messages'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'GET',
        path: '/api/agent-messages',
        query: { sessionId: str(args, 'sessionId'), box: optStr(args, 'box'), state: optStr(args, 'state') },
      }),
  }),
];
