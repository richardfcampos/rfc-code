/**
 * Contracts of the Grokbot MCP module.
 *
 * A tool is a declarative record: a JSON Schema for its input, the REST routes
 * it stands in for (`covers`, checked by the route-coverage test) and a `run`
 * that turns validated arguments into one call on the tool context. The
 * context itself is built once by the composition root and holds the three
 * ways a tool can act: loopback REST, the in-process chat gateway and a
 * one-shot shell runner.
 */

export type JsonObject = Record<string, unknown>;

export type JsonSchema = {
  type: 'object';
  properties: Record<string, JsonObject>;
  required?: string[];
  additionalProperties?: boolean;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RestMultipartFile = {
  /** Multipart field name, e.g. `file`, `files`, `images`. */
  field: string;
  fileName: string;
  contentBase64: string;
  mimeType?: string;
};

export type RestRequest = {
  method: HttpMethod;
  /** Path under the server root, always starting with `/api` or `/health`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** When set, the request is sent as multipart/form-data instead of JSON. */
  multipart?: { files: RestMultipartFile[]; fields?: Record<string, string> };
  /** `json` (default) parses and unwraps; `bytes` returns base64; `sse` collects events. */
  responseType?: 'json' | 'bytes' | 'sse';
  /** For `sse`: stop collecting once an event satisfies this predicate. */
  sseUntil?: (event: JsonObject) => boolean;
  /** Per-request timeout; defaults are chosen by the dispatcher. */
  timeoutMs?: number;
};

export type RestBytesResult = {
  contentBase64: string;
  mimeType: string;
  /** Bytes actually received before the read stopped (more than the cap when `truncated`). */
  size: number;
  truncated: boolean;
  /** Length the server announced in `Content-Length`, when it sent one. */
  contentLength?: number;
};
/** `truncated` is set when the event or unparsed-buffer cap ended the read early. */
export type RestSseResult = { events: JsonObject[]; truncated?: boolean };

export interface RestDispatcher {
  dispatch(request: RestRequest): Promise<unknown>;
}

export type ChatSendInput = {
  sessionId: string;
  content: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  toolsSettings?: JsonObject;
  images?: unknown;
  wait?: boolean;
  timeoutMs?: number;
  /** User the API key resolved to; the run notifies them when it finishes. */
  userId?: number | null;
};

export type ChatSendResult = {
  sessionId: string;
  provider: string;
  started: boolean;
  /** Only when `wait` was requested and the run completed in time. */
  completed?: boolean;
  text?: string;
  /** Only the last frames of the turn; `eventsTruncated` says older ones were dropped. */
  events?: JsonObject[];
  eventsTruncated?: boolean;
  /** Last event sequence number of the run, to continue with session_events. */
  lastSeq?: number;
  timedOut?: boolean;
};

export interface ChatGateway {
  send(input: ChatSendInput): Promise<ChatSendResult>;
  abort(sessionId: string): Promise<{ sessionId: string; aborted: boolean }>;
  events(sessionId: string, afterSeq: number): JsonObject[];
  status(sessionId: string): { sessionId: string; isProcessing: boolean; lastSeq: number; provider: string | null };
  pendingApprovals(sessionId: string): JsonObject[];
  /** With `sessionId`, an id not pending on that session is refused with `reason: 'UNKNOWN_REQUEST'`. */
  approveTool(input: { requestId: string; allow: boolean; updatedInput?: unknown; message?: string; sessionId?: string }): {
    requestId: string;
    resolved: boolean;
    reason?: string;
  };
}

export type ShellExecInput = { cwd: string; command: string; timeoutMs?: number; maxOutputBytes?: number };
export type ShellExecResult = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean };

export interface ShellRunner {
  exec(input: ShellExecInput): Promise<ShellExecResult>;
}

export type ToolContext = {
  api: RestDispatcher;
  chat: ChatGateway;
  shell: ShellRunner;
  /** Who the API key resolved to; turns started for them notify them. */
  user: GrokbotUser;
  /** Resolves a project registry id to its absolute path (for shell cwd). */
  resolveProjectPath(projectId: string): Promise<string | null>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Routes this tool stands in for, as `METHOD /api/path/:param`; `[]` only for in-process tools. */
  covers: string[];
  run(args: JsonObject, ctx: ToolContext): Promise<unknown>;
};

/** Shape MCP clients expect from `tools/call`. */
export type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc?: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: JsonObject;
};

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

/** Who the API key resolved to; carried from the auth middleware into the handler. */
export type GrokbotUser = { id: number; username: string };
