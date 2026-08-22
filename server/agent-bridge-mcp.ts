#!/usr/bin/env node
/**
 * Agent Bridge MCP server (stdio).
 *
 * A thin JSON-RPC front end for `/api/agent-bridge/tools/*`: it declares the
 * bridge tools to the agent runtime and forwards each call to the local server
 * with the per-session bearer token it was started with. All scope lives in
 * that token — the agent never names a project, and this process holds no
 * state of its own.
 */
import './load-env.js';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const textResponse = (text: string) => ({
  content: [{ type: 'text', text }],
});

const jsonResponse = (value: unknown) => textResponse(JSON.stringify(value, null, 2));

const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
};

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const apiUrl = (process.env.CLOUDCLI_AGENT_BRIDGE_API_URL || 'http://127.0.0.1:3001/api/agent-bridge').replace(/\/$/, '');
const apiToken = process.env.CLOUDCLI_AGENT_BRIDGE_TOKEN || '';
const API_TIMEOUT_MS = Number.parseInt(process.env.CLOUDCLI_AGENT_BRIDGE_API_TIMEOUT_MS || '30000', 10);

/** Server errors arrive as `{ code, message }`; older surfaces send a string. */
function readErrorMessage(error: unknown, status: number): string {
  if (typeof error === 'string' && error) {
    return error;
  }
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown };
    if (typeof record.message === 'string' && record.message) {
      return typeof record.code === 'string' ? `${record.message} (${record.code})` : record.message;
    }
  }
  return `Agent bridge request failed (${status}).`;
}

async function callBridgeApi(toolName: string, input: Record<string, unknown>) {
  if (!apiToken) {
    throw new Error('CLOUDCLI_AGENT_BRIDGE_TOKEN is not configured.');
  }

  const response = await fetch(`${apiUrl}/tools/${encodeURIComponent(toolName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({})) as {
    success?: boolean;
    data?: unknown;
    error?: unknown;
  };
  if (!response.ok || data.success === false) {
    throw new Error(readErrorMessage(data.error, response.status));
  }
  return data.data;
}

const tools: ToolDefinition[] = [
  {
    name: 'task_create',
    description: 'Create a task on this project\'s board. Use it to record work you found or were asked to do, so it stays visible after this run.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short imperative title, 500 characters max.' },
        description: { type: 'string', description: 'Optional detail: context, acceptance criteria, links.' },
        suggested_skill: { type: 'string', description: 'Optional skill or agent that should pick this up.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'task_list',
    description: 'List this project\'s board tasks. Check it before creating a task so you do not duplicate one.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['backlog', 'in_progress', 'review', 'done'],
          description: 'Optional stage filter. Omit to list every task.',
        },
      },
    },
  },
  {
    name: 'task_update_stage',
    description: 'Move a task to another stage. Use it to report progress: in_progress when you start, review when it needs a human, done when it is finished.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Id of a task on this project\'s board.' },
        stage: {
          type: 'string',
          enum: ['backlog', 'in_progress', 'review', 'done'],
        },
      },
      required: ['taskId', 'stage'],
    },
  },
  {
    name: 'task_assign',
    description: 'Assign a task to an account profile. The organization policy decides which profiles this project allows; a refusal explains why.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Id of a task on this project\'s board.' },
        profileId: { type: 'string', description: 'Account profile id, as returned by profile_recommend.' },
      },
      required: ['taskId', 'profileId'],
    },
  },
  {
    name: 'profile_recommend',
    description: 'Ask which account profile this project should use next, given policy and remaining plan quota. Call it before task_assign.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['claude', 'codex', 'cursor', 'opencode'],
          description: 'Optional provider filter. Omit to consider every provider.',
        },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'task_create':
      return jsonResponse(await callBridgeApi(name, {
        title: readString(args.title, 'title'),
        description: readOptionalString(args.description),
        suggested_skill: readOptionalString(args.suggested_skill),
      }));
    case 'task_list':
      return jsonResponse(await callBridgeApi(name, {
        stage: readOptionalString(args.stage),
      }));
    case 'task_update_stage':
      return jsonResponse(await callBridgeApi(name, {
        taskId: readString(args.taskId, 'taskId'),
        stage: readString(args.stage, 'stage'),
      }));
    case 'task_assign':
      return jsonResponse(await callBridgeApi(name, {
        taskId: readString(args.taskId, 'taskId'),
        profileId: readString(args.profileId, 'profileId'),
      }));
    case 'profile_recommend':
      return jsonResponse(await callBridgeApi(name, {
        provider: readOptionalString(args.provider),
      }));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'cloudcli-agent-bridge', version: '1.0.0' },
    };
  }

  if (message.method === 'tools/list') {
    return { tools };
  }

  if (message.method === 'tools/call') {
    const params = message.params || {};
    const name = readString(params.name, 'name');
    const args = (params.arguments && typeof params.arguments === 'object'
      ? params.arguments
      : {}) as Record<string, unknown>;
    return callTool(name, args);
  }

  if (message.method.startsWith('notifications/')) {
    return undefined;
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

function writeMessage(message: Record<string, unknown>) {
  // MCP stdio transport uses newline-delimited JSON (one JSON-RPC message per line,
  // no embedded newlines). This is NOT the LSP Content-Length framing.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id: string | number | null | undefined, result: unknown) {
  if (id === undefined) {
    return;
  }
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id: string | number | null | undefined, error: unknown) {
  if (id === undefined) {
    return;
  }
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const rawMessage = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!rawMessage) {
      continue;
    }

    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(rawMessage) as JsonRpcRequest;
      } catch (error) {
        sendError(null, error);
        return;
      }
      try {
        const result = await handleMessage(request);
        sendResult(request.id, result);
      } catch (error) {
        sendError(request.id, error);
      }
    })();
  }
});
