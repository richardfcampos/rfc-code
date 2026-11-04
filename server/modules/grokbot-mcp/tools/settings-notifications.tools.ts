/** Notification preferences, delivery endpoints and the notify-hub relay. */

import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { S, ToolInputError, optBool, optObject, optStr, pick, schema, seg, str, tool } from './tool-helpers.js';

/** Booleans that flip state must be explicit: a missing flag is a mistake, not "false". */
export function requiredBool(args: JsonObject, name: string): boolean {
  const value = optBool(args, name);
  if (value === undefined) {
    throw new ToolInputError(`${name} is required.`);
  }
  return value;
}

function requiredObject(args: JsonObject, name: string): JsonObject {
  const value = optObject(args, name);
  if (value === undefined) {
    throw new ToolInputError(`${name} is required.`);
  }
  return value;
}

const CHANNEL = S.string('Notification channel name, e.g. "push", "telegram" or "session_webhook".');
const ENDPOINT_ID = S.string('Endpoint id within the channel (device, chat identifier, or a name you choose for a session webhook).');

const SESSION_WEBHOOK_CHANNEL = 'session_webhook';
const SESSION_WEBHOOK_KEYS = ['url', 'secret', 'events', 'projects', 'sessions'] as const;

function optStringList(args: JsonObject, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ToolInputError(`${name} must be an array of strings.`);
  }
  return value as string[];
}

/**
 * The session webhook fields ride inside `metadata` for the route; they are
 * only meaningful on that channel, so naming them on another one is refused
 * instead of being stored as inert junk.
 */
function sessionWebhookMetadata(args: JsonObject, channel: string): JsonObject | undefined {
  const fields: JsonObject = {};
  const url = optStr(args, 'url');
  const secret = optStr(args, 'secret');
  const events = optStringList(args, 'events');
  const projects = optStringList(args, 'projects');
  const sessions = optStringList(args, 'sessions');
  if (url !== undefined) fields.url = url;
  if (secret !== undefined) fields.secret = secret;
  if (events !== undefined) fields.events = events;
  if (projects !== undefined) fields.projects = projects;
  if (sessions !== undefined) fields.sessions = sessions;
  if (Object.keys(fields).length === 0) return undefined;
  if (channel !== SESSION_WEBHOOK_CHANNEL) {
    throw new ToolInputError(`${SESSION_WEBHOOK_KEYS.join(', ')} are only valid with channel "${SESSION_WEBHOOK_CHANNEL}".`);
  }
  return fields;
}

export const settingsNotificationTools: ToolDefinition[] = [
  tool({
    name: 'notification_preferences_get',
    description: 'Read the notification preferences (which channels and event kinds are enabled) stored on the server.',
    inputSchema: schema({}),
    covers: ['GET /api/settings/notification-preferences'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/settings/notification-preferences' }),
  }),
  tool({
    name: 'notification_preferences_set',
    description:
      'Replace the notification preferences. Pass the full preferences object (read it with notification_preferences_get first and modify it); it is stored as given.',
    inputSchema: schema({ preferences: S.object('Complete notification preferences object.') }, ['preferences']),
    covers: ['PUT /api/settings/notification-preferences'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'PUT', path: '/api/settings/notification-preferences', body: requiredObject(args, 'preferences') }),
  }),
  tool({
    name: 'notification_endpoints',
    description: 'List the registered delivery endpoints of one notification channel (tokens are masked by the server).',
    inputSchema: schema({ channel: CHANNEL }, ['channel']),
    covers: ['GET /api/notifications/endpoints'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'GET', path: '/api/notifications/endpoints', query: { channel: str(args, 'channel') } }),
  }),
  tool({
    name: 'notification_endpoint_upsert',
    description:
      'Register or update a delivery endpoint on a channel and refresh the channel preference. Use endpointId to address an existing endpoint. ' +
      'With channel "session_webhook" pass url (http/https), secret (HMAC-SHA256 key; omit on update to keep it), and optional filters ' +
      'events (subset of session.idle, session.error, session.waiting_approval; default all), projects (ids or paths) and sessions (ids); ' +
      'the server then POSTs a signed payload (header X-RFC-Signature) whenever a matching session stops, fails or waits on an approval.',
    inputSchema: schema(
      {
        channel: CHANNEL,
        endpointId: ENDPOINT_ID,
        label: S.string('Human-readable label.'),
        metadata: S.object('Channel-specific metadata (e.g. chat id).'),
        enabled: S.boolean('Whether the endpoint receives notifications (default true).'),
        url: S.string('session_webhook only: URL that receives the POST.'),
        secret: S.string('session_webhook only: shared secret used to sign the body; never returned.'),
        events: S.stringArray('session_webhook only: events to deliver; default all three.'),
        projects: S.stringArray('session_webhook only: project ids or absolute paths to deliver for; empty = all.'),
        sessions: S.stringArray('session_webhook only: session ids to deliver for; empty = all.'),
      },
      ['channel', 'endpointId'],
    ),
    covers: ['POST /api/notifications/endpoints/current'],
    run: (args, ctx) => {
      const channel = str(args, 'channel');
      const webhook = sessionWebhookMetadata(args, channel);
      const body: JsonObject = { channel, endpointId: str(args, 'endpointId'), ...pick(args, ['label', 'metadata', 'enabled']) };
      if (webhook) {
        body.metadata = { ...(optObject(args, 'metadata') ?? {}), ...webhook };
      }
      return ctx.api.dispatch({ method: 'POST', path: '/api/notifications/endpoints/current', body });
    },
  }),
  tool({
    name: 'notification_endpoint_toggle',
    description: 'Enable or disable one notification endpoint without deleting it.',
    inputSchema: schema({ channel: CHANNEL, endpointId: ENDPOINT_ID, enabled: S.boolean('New enabled state.') }, [
      'channel',
      'endpointId',
      'enabled',
    ]),
    covers: ['PATCH /api/notifications/endpoints/:channel/:endpointId'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'PATCH',
        path: `/api/notifications/endpoints/${seg(str(args, 'channel'))}/${seg(str(args, 'endpointId'))}`,
        body: { enabled: requiredBool(args, 'enabled') },
      }),
  }),
  tool({
    name: 'notification_endpoint_delete',
    description: 'Delete a notification endpoint from a channel permanently.',
    inputSchema: schema({ channel: CHANNEL, endpointId: ENDPOINT_ID }, ['channel', 'endpointId']),
    covers: ['DELETE /api/notifications/endpoints/:channel/:endpointId'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'DELETE',
        path: `/api/notifications/endpoints/${seg(str(args, 'channel'))}/${seg(str(args, 'endpointId'))}`,
      }),
  }),
  tool({
    name: 'notify_hub_get',
    description: 'Read the notify-hub relay configuration (url, timezone, whether a token is set; the token itself is never returned).',
    inputSchema: schema({}),
    covers: ['GET /api/notifications/notify-hub'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/notifications/notify-hub' }),
  }),
  tool({
    name: 'notify_hub_set',
    description: 'Save the notify-hub relay configuration. Omit token to keep the stored one.',
    inputSchema: schema(
      {
        url: S.string('notify-hub base URL.'),
        token: S.string('Bearer token for notify-hub.'),
        timezone: S.string('IANA timezone used when formatting notifications, e.g. America/Sao_Paulo.'),
      },
      ['url'],
    ),
    covers: ['PUT /api/notifications/notify-hub'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'PUT',
        path: '/api/notifications/notify-hub',
        body: { url: str(args, 'url'), ...pick(args, ['token', 'timezone']) },
      }),
  }),
  tool({
    name: 'notify_hub_test',
    description: 'Send a test notification through the configured notify-hub to verify the relay works.',
    inputSchema: schema({}),
    covers: ['POST /api/notifications/notify-hub/test'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'POST', path: '/api/notifications/notify-hub/test' }),
  }),
];
