/**
 * JSON-RPC 2.0 / MCP method dispatch, independent of any transport.
 *
 * Only the methods a tools-only MCP server needs: `initialize`, `ping`,
 * `tools/list`, `tools/call`; notifications are acknowledged silently. A
 * failing tool is a *successful* RPC whose result carries `isError` — that is
 * how MCP wants the model to see a refused action — while a malformed request
 * or an unknown tool is a JSON-RPC error.
 */

import { ToolInputError } from './tools/tool-helpers.js';
import type {
  JsonObject,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  ToolCallResult,
  ToolContext,
  ToolDefinition,
} from './grokbot-mcp.types.js';

export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_SERVER_INFO = { name: 'rfc-code-grokbot', version: '1.0.0' };

export const JSON_RPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNAUTHORIZED: -32001,
} as const;

export class JsonRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

export type ToolRegistry = {
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
};

export function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

function textResult(value: unknown, isError = false): ToolCallResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

/**
 * Rejects a call that omits a `required` argument before the tool ever runs.
 * `null` counts as present: some routes take an explicit null to clear a value
 * (a session's caveman mode falling back to its profile), and the tool's own
 * reader decides whether null is acceptable.
 */
function assertRequiredArgs(definition: ToolDefinition, args: JsonObject): void {
  for (const key of definition.inputSchema.required ?? []) {
    if (args[key] === undefined) {
      throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, `Missing required argument "${key}" for ${definition.name}.`);
    }
  }
}

/** Errors the server-side call produced are reported to the model, not to the transport. */
function describeToolFailure(error: unknown): string {
  if (error instanceof Error) {
    const record = error as Error & { status?: number; code?: string };
    const prefix = [record.status, record.code].filter((part) => part !== undefined).join(' ');
    return prefix ? `${prefix}: ${error.message}` : error.message;
  }
  return String(error);
}

async function callTool(params: JsonObject, registry: ToolRegistry, ctx: ToolContext): Promise<ToolCallResult> {
  const name = typeof params.name === 'string' ? params.name : '';
  const definition = name ? registry.get(name) : undefined;
  if (!definition) {
    throw new JsonRpcError(JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown tool: ${name || '(empty)'}`);
  }

  const rawArgs = params.arguments;
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as JsonObject) : {};
  assertRequiredArgs(definition, args);

  try {
    return textResult(await definition.run(args, ctx));
  } catch (error) {
    if (error instanceof ToolInputError) {
      throw new JsonRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, error.message);
    }
    return textResult(describeToolFailure(error), true);
  }
}

async function handleMethod(request: JsonRpcRequest, registry: ToolRegistry, ctx: ToolContext): Promise<unknown> {
  const params = (request.params && typeof request.params === 'object' ? request.params : {}) as JsonObject;
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          'RFC Code control plane. Every tool maps to what the web UI can do; ' +
          'use project_list first to learn project ids, and rfc_api_call for any route without a dedicated tool.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return {
        tools: registry.list().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      };
    case 'tools/call':
      return callTool(params, registry, ctx);
    default:
      throw new JsonRpcError(JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unsupported method: ${request.method}`);
  }
}

/**
 * Handles one request object. Returns `null` for notifications (no `id`),
 * which the transport must not answer.
 */
export async function handleJsonRpcRequest(
  request: unknown,
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<JsonRpcResponse | null> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Request must be a JSON object.');
  }
  const message = request as JsonRpcRequest;
  const id: JsonRpcId = message.id === undefined ? null : message.id;
  const isNotification = message.id === undefined;

  if (typeof message.method !== 'string' || message.method.length === 0) {
    return isNotification ? null : errorResponse(id, JSON_RPC_ERRORS.INVALID_REQUEST, 'method is required.');
  }
  if (message.method.startsWith('notifications/')) {
    return null;
  }

  try {
    const result = await handleMethod(message, registry, ctx);
    return isNotification ? null : { jsonrpc: '2.0', id, result };
  } catch (error) {
    if (isNotification) {
      return null;
    }
    if (error instanceof JsonRpcError) {
      return errorResponse(id, error.code, error.message, error.data);
    }
    return errorResponse(id, JSON_RPC_ERRORS.INTERNAL, error instanceof Error ? error.message : String(error));
  }
}

/**
 * One POST may carry at most this many requests. Entries run one after another:
 * a batch of shell commands, clones or chat turns must not fan out into
 * parallel work the client never paced.
 */
export const MAX_BATCH_SIZE = 20;

/** Handles a single request or a JSON-RPC batch; an empty or oversized batch is invalid. */
export async function handleJsonRpcPayload(
  payload: unknown,
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Empty batch.');
    }
    if (payload.length > MAX_BATCH_SIZE) {
      return errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, `Batch too large (max ${MAX_BATCH_SIZE}).`);
    }
    const answered: JsonRpcResponse[] = [];
    for (const entry of payload) {
      const response = await handleJsonRpcRequest(entry, registry, ctx);
      if (response !== null) {
        answered.push(response);
      }
    }
    return answered.length > 0 ? answered : null;
  }
  return handleJsonRpcRequest(payload, registry, ctx);
}
