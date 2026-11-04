/** Session webhook tools: test an endpoint and read its delivery log. Endpoints themselves are managed with notification_endpoint_* on channel "session_webhook". */

import type { ToolDefinition } from '../grokbot-mcp.types.js';

import { S, optInt, optStr, schema, seg, str, tool } from './tool-helpers.js';

export const sessionWebhookTools: ToolDefinition[] = [
  tool({
    name: 'notification_endpoint_test',
    description:
      'Send a signed "session.test" payload to one session_webhook endpoint through the real delivery path (retries and delivery log included). ' +
      'Returns ok, deliveryId, attempts and the last HTTP status.',
    inputSchema: schema({ endpointId: S.string('Endpoint id registered on channel "session_webhook".') }, ['endpointId']),
    covers: ['POST /api/notifications/session-webhooks/:endpointId/test'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: `/api/notifications/session-webhooks/${seg(str(args, 'endpointId'))}/test` }),
  }),
  tool({
    name: 'notification_deliveries',
    description:
      'List session webhook delivery attempts, newest first: one row per attempt with event, session, attempt number, ok flag, HTTP status and error. ' +
      'Filter by endpointId and/or sessionId; limit defaults to 50 (max 200).',
    inputSchema: schema({
      endpointId: S.string('Only deliveries to this endpoint.'),
      sessionId: S.string('Only deliveries about this session.'),
      limit: S.integer('Max rows (default 50, max 200).'),
    }),
    covers: ['GET /api/notifications/session-webhooks/deliveries'],
    run: (args, ctx) => {
      const endpointId = optStr(args, 'endpointId');
      const sessionId = optStr(args, 'sessionId');
      const limit = optInt(args, 'limit');
      return ctx.api.dispatch({
        method: 'GET',
        path: '/api/notifications/session-webhooks/deliveries',
        query: {
          ...(endpointId !== undefined && { endpointId }),
          ...(sessionId !== undefined && { sessionId }),
          ...(limit !== undefined && { limit }),
        },
      });
    },
  }),
];
