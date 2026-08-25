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
    name: 'task_update_description',
    description: 'Replace a task\'s description. Use it to write down what you found, what you decided, or what is left, so the next run starts from your notes.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Id of a task on this project\'s board.' },
        description: { type: 'string', description: 'The new description, in markdown. Replaces the previous one.' },
      },
      required: ['taskId', 'description'],
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
    name: 'task_evidence_add',
    description: 'Append a work-log entry to a task: what you ran, what you read, what it proved. Uploading a file is not possible here — log its path as a link instead.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Id of a task on this project\'s board.' },
        kind: {
          type: 'string',
          enum: ['note', 'link'],
          description: 'note for prose, link for a URL or a file path.',
        },
        content: { type: 'string', description: 'The note text, or the URL / file path when kind is link.' },
      },
      required: ['taskId', 'kind', 'content'],
    },
  },
  {
    name: 'task_decompose',
    description: 'Split a task on this project\'s board into subtasks with dependencies, in one plan. Only a top-level task can be decomposed, and a plan that references a missing subtask or forms a cycle is refused whole.',
    inputSchema: {
      type: 'object',
      properties: {
        parentTaskId: { type: 'string', description: 'Id of the task to break up; it must not already be a subtask.' },
        subtasks: {
          type: 'array',
          description: 'The plan, in order. At most 50 entries.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short imperative title, 500 characters max.' },
              description: { type: 'string', description: 'Optional detail: context, acceptance criteria, links.' },
              skill: { type: 'string', description: 'Optional skill or agent that should pick this subtask up.' },
              dependsOn: {
                type: 'array',
                items: { type: 'integer' },
                description: 'Positions in this same array that must finish first. Subtasks have no ids yet, so dependencies are indices.',
              },
            },
            required: ['title'],
          },
        },
      },
      required: ['parentTaskId', 'subtasks'],
    },
  },
  {
    name: 'task_ready_list',
    description: 'List the subtasks of a plan that can start right now: still in backlog, with every dependency done. Call it before task_delegate so you hand out work that is actually unblocked.',
    inputSchema: {
      type: 'object',
      properties: {
        parentTaskId: { type: 'string', description: 'Id of the decomposed parent task.' },
      },
      required: ['parentTaskId'],
    },
  },
  {
    name: 'task_delegate',
    description: 'Hand a task to a worker: it is assigned on the board and a handoff message describing it is queued in the worker\'s inbox. Refused while the task still waits on unfinished dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Id of a task on this project\'s board.' },
        toSessionId: {
          type: 'string',
          description: 'Session that should receive the handoff. Omit to assign the task without telling anyone.',
        },
        profileId: {
          type: 'string',
          description: 'Account profile to assign. Omit to let the quota-aware recommender pick one; a named one is checked against org policy first.',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'message_send',
    description: 'Queue a handoff message in another session\'s inbox. The sender is always you — it comes from your token, not from this call.',
    inputSchema: {
      type: 'object',
      properties: {
        toSessionId: { type: 'string', description: 'Session id of the recipient. It must still be alive.' },
        subject: { type: 'string', description: 'One-line summary, 200 characters max.' },
        body: { type: 'string', description: 'The handoff itself: context, what you did, what the recipient should do.' },
        replyToMessageId: {
          type: 'string',
          description: 'Optional id of a message in your own mailbox that this one threads onto.',
        },
      },
      required: ['toSessionId', 'subject', 'body'],
    },
  },
  {
    name: 'message_list',
    description: 'Read your mailbox. Reading the inbox is the delivery event: the queued messages it returns come back marked delivered, so poll it to pick up handoffs.',
    inputSchema: {
      type: 'object',
      properties: {
        box: {
          type: 'string',
          enum: ['inbox', 'outbox'],
          description: 'Which side to read. Defaults to inbox — the messages waiting on you.',
        },
        state: {
          type: 'string',
          enum: ['queued', 'delivered', 'acknowledged', 'answered', 'failed'],
          description: 'Optional state filter. Omit to list the whole box.',
        },
      },
    },
  },
  {
    name: 'message_ack',
    description: 'Acknowledge a message you received: "I have this, I am working on it". Only a message delivered to you can be acknowledged.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Id of a message in your inbox.' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'message_answer',
    description: 'Answer a message you received: it is marked answered and your reply is queued back to its sender, linked to the original.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Id of a message in your inbox.' },
        body: { type: 'string', description: 'The answer itself.' },
        subject: {
          type: 'string',
          description: 'Optional subject for the reply. Omitted, it becomes "Re: " plus the original subject.',
        },
      },
      required: ['messageId', 'body'],
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
  {
    name: 'review_comment_add',
    description: 'Post a comment on the task\'s live review. This is the only review tool: there is no way to approve a review or request changes through the bridge — a human decides that in the Review Center.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Id of a task on this project\'s board with a review waiting on it.' },
        filePath: {
          type: 'string',
          description: 'Repository-relative path the comment is about. Omit to comment on the review as a whole.',
        },
        lineNo: { type: 'integer', description: 'Optional line number within filePath.' },
        body: { type: 'string', description: 'What is wrong (or right) and what to do about it.' },
      },
      required: ['taskId', 'body'],
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
    case 'task_update_description':
      return jsonResponse(await callBridgeApi(name, {
        taskId: readString(args.taskId, 'taskId'),
        description: readString(args.description, 'description'),
      }));
    case 'task_assign':
      return jsonResponse(await callBridgeApi(name, {
        taskId: readString(args.taskId, 'taskId'),
        profileId: readString(args.profileId, 'profileId'),
      }));
    case 'task_evidence_add':
      return jsonResponse(await callBridgeApi(name, {
        taskId: readString(args.taskId, 'taskId'),
        kind: readString(args.kind, 'kind'),
        content: readString(args.content, 'content'),
      }));
    // `subtasks` is a nested plan whose indices, cycles and per-entry fields are
    // all checked together server-side; re-reading it here could only disagree
    // with that check, so it travels as sent.
    case 'task_decompose':
      return jsonResponse(await callBridgeApi(name, {
        parentTaskId: readString(args.parentTaskId, 'parentTaskId'),
        subtasks: args.subtasks,
      }));
    case 'task_ready_list':
      return jsonResponse(await callBridgeApi(name, {
        parentTaskId: readString(args.parentTaskId, 'parentTaskId'),
      }));
    case 'task_delegate':
      return jsonResponse(await callBridgeApi(name, {
        taskId: readString(args.taskId, 'taskId'),
        toSessionId: readOptionalString(args.toSessionId),
        profileId: readOptionalString(args.profileId),
      }));
    // The message tools forward what they were given: the Agent Messages module
    // validates every field of a handoff — lengths, state machine, who may touch
    // what — and repeating half of those rules here is how the two copies start
    // disagreeing about which handoff is valid.
    case 'message_send':
      return jsonResponse(await callBridgeApi(name, {
        toSessionId: args.toSessionId,
        subject: args.subject,
        body: args.body,
        replyToMessageId: args.replyToMessageId,
      }));
    case 'message_list':
      return jsonResponse(await callBridgeApi(name, {
        box: args.box,
        state: args.state,
      }));
    case 'message_ack':
      return jsonResponse(await callBridgeApi(name, {
        messageId: args.messageId,
      }));
    case 'message_answer':
      return jsonResponse(await callBridgeApi(name, {
        messageId: args.messageId,
        body: args.body,
        subject: args.subject,
      }));
    case 'profile_recommend':
      return jsonResponse(await callBridgeApi(name, {
        provider: readOptionalString(args.provider),
      }));
    case 'review_comment_add':
      return jsonResponse(await callBridgeApi(name, {
        taskId: readString(args.taskId, 'taskId'),
        filePath: readOptionalString(args.filePath),
        lineNo: typeof args.lineNo === 'number' ? args.lineNo : undefined,
        body: readString(args.body, 'body'),
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
