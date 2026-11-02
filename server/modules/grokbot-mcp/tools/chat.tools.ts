/**
 * Chat tools. They act on the in-process chat gateway instead of the REST
 * loopback because a turn is driven over the WebSocket protocol, which has no
 * HTTP route; hence `covers` is empty for all of them.
 */
import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optBool, optInt, optObject, optStr, S, schema, str, tool, ToolInputError } from './tool-helpers.js';

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const;
const SESSION_ID = S.string('Session id, as returned by session_create or session_list.');

function optPermissionMode(args: JsonObject): string | undefined {
  const mode = optStr(args, 'permissionMode');
  if (mode !== undefined && !(PERMISSION_MODES as readonly string[]).includes(mode)) {
    throw new ToolInputError(`permissionMode must be one of: ${PERMISSION_MODES.join(', ')}.`);
  }
  return mode;
}

function optImages(args: JsonObject): unknown[] | undefined {
  const images = args.images;
  if (images === undefined || images === null) {
    return undefined;
  }
  if (!Array.isArray(images)) {
    throw new ToolInputError('images must be an array.');
  }
  return images;
}

export const chatTools: ToolDefinition[] = [
  tool({
    name: 'session_send',
    description:
      'Send a user message to a chat session so the agent runs a turn. Create the session first with session_create ' +
      'and pass its sessionId. With wait=true the call blocks until the turn completes (timeoutMs, default 120s) and ' +
      'returns the assistant text; without wait it returns immediately, and you should poll session_status and ' +
      'session_events (afterSeq) to follow progress and read the result.',
    inputSchema: schema(
      {
        sessionId: SESSION_ID,
        content: S.string('The message text to send to the agent.'),
        model: S.string('Model id override for this turn; defaults to the session model.'),
        effort: S.string('Reasoning effort override for this turn, when the provider supports it.'),
        permissionMode: S.enumOf(PERMISSION_MODES, 'Permission mode for the turn.'),
        toolsSettings: {
          type: 'object',
          description: 'Tool permission settings for the turn.',
          properties: {
            allowedTools: S.stringArray('Tools the agent may use without asking.'),
            disallowedTools: S.stringArray('Tools the agent must not use.'),
            skipPermissions: S.boolean('Skip permission prompts entirely.'),
          },
          additionalProperties: true,
        },
        images: S.array({ type: 'object', additionalProperties: true }, 'Image attachments, as accepted by the chat UI.'),
        wait: S.boolean('Block until the turn completes and return the assistant text. Default false.'),
        timeoutMs: S.integer('How long wait=true blocks, in milliseconds. Default 120000. The turn keeps running after a timeout.'),
      },
      ['sessionId', 'content'],
    ),
    covers: [],
    async run(args, ctx) {
      const input: Parameters<typeof ctx.chat.send>[0] = {
        sessionId: str(args, 'sessionId'),
        content: str(args, 'content'),
        // Not a tool argument: the turn belongs to whoever owns the API key.
        userId: ctx.user.id,
      };
      const optional = {
        model: optStr(args, 'model'),
        effort: optStr(args, 'effort'),
        permissionMode: optPermissionMode(args),
        toolsSettings: optObject(args, 'toolsSettings'),
        images: optImages(args),
        wait: optBool(args, 'wait'),
        timeoutMs: optInt(args, 'timeoutMs'),
      };
      for (const [key, value] of Object.entries(optional)) {
        if (value !== undefined) {
          (input as Record<string, unknown>)[key] = value;
        }
      }
      return ctx.chat.send(input);
    },
  }),
  tool({
    name: 'session_abort',
    description: 'Abort the turn currently running in a chat session. Use when an agent run is stuck or no longer wanted.',
    inputSchema: schema({ sessionId: SESSION_ID }, ['sessionId']),
    covers: [],
    run: (args, ctx) => ctx.chat.abort(str(args, 'sessionId')),
  }),
  tool({
    name: 'session_status',
    description: 'Report whether a chat session is currently processing a turn, its last event sequence number and its provider. Poll after session_send without wait.',
    inputSchema: schema({ sessionId: SESSION_ID }, ['sessionId']),
    covers: [],
    run: async (args, ctx) => ctx.chat.status(str(args, 'sessionId')),
  }),
  tool({
    name: 'session_events',
    description:
      'Read the events a chat session produced after a sequence number (assistant text, tool calls, errors, completion). ' +
      'Pass the last seq you saw as afterSeq to read only new events; default 0 returns everything buffered.',
    inputSchema: schema(
      { sessionId: SESSION_ID, afterSeq: S.integer('Return only events with a sequence number greater than this. Default 0.') },
      ['sessionId'],
    ),
    covers: [],
    run: async (args, ctx) => ctx.chat.events(str(args, 'sessionId'), optInt(args, 'afterSeq') ?? 0),
  }),
  tool({
    name: 'session_pending_approvals',
    description: 'List tool-permission requests a chat session is waiting on. Answer each one with session_approve_tool using its requestId.',
    inputSchema: schema({ sessionId: SESSION_ID }, ['sessionId']),
    covers: [],
    run: async (args, ctx) => ctx.chat.pendingApprovals(str(args, 'sessionId')),
  }),
  tool({
    name: 'session_approve_tool',
    description:
      'Allow or deny a pending tool-permission request of a chat session. requestId comes from session_pending_approvals. ' +
      'Pass sessionId too so an id that is no longer pending comes back as resolved=false with reason UNKNOWN_REQUEST.',
    inputSchema: schema(
      {
        requestId: S.string('Approval request id from session_pending_approvals.'),
        sessionId: S.string('Session the request belongs to; when given, the id is checked against its pending approvals first.'),
        allow: S.boolean('true to allow the tool call, false to deny it.'),
        updatedInput: { description: 'Replacement tool input to run instead of the requested one (only when allowing).' },
        message: S.string('Explanation returned to the agent, typically when denying.'),
      },
      ['requestId', 'allow'],
    ),
    covers: [],
    run: async (args, ctx) => {
      const requestId = str(args, 'requestId');
      const allow = optBool(args, 'allow');
      if (allow === undefined) {
        throw new ToolInputError('allow is required.');
      }
      const input: Parameters<typeof ctx.chat.approveTool>[0] = { requestId, allow };
      if (args.updatedInput !== undefined) {
        input.updatedInput = args.updatedInput;
      }
      const message = optStr(args, 'message');
      if (message !== undefined) {
        input.message = message;
      }
      const sessionId = optStr(args, 'sessionId');
      if (sessionId !== undefined) {
        input.sessionId = sessionId;
      }
      return ctx.chat.approveTool(input);
    },
  }),
];
