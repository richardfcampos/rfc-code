/**
 * Test doubles for the tool context: a recording REST dispatcher, a scripted
 * chat gateway and a scripted shell runner. Tool mapping tests assert on the
 * requests the dispatcher recorded; nothing here touches the network.
 */

import type {
  ChatGateway,
  JsonObject,
  RestDispatcher,
  RestRequest,
  ShellRunner,
  ToolContext,
} from '../../grokbot-mcp.types.js';

export type RecordingDispatcher = RestDispatcher & {
  calls: RestRequest[];
  /** What the next dispatch resolves with; defaults to `{ ok: true }`. */
  nextResult: unknown;
  nextError: Error | null;
};

export function createRecordingDispatcher(): RecordingDispatcher {
  const dispatcher: RecordingDispatcher = {
    calls: [],
    nextResult: { ok: true },
    nextError: null,
    async dispatch(request) {
      dispatcher.calls.push(request);
      if (dispatcher.nextError) {
        const error = dispatcher.nextError;
        dispatcher.nextError = null;
        throw error;
      }
      return dispatcher.nextResult;
    },
  };
  return dispatcher;
}

export function createFakeChatGateway(overrides: Partial<ChatGateway> = {}): ChatGateway & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  return {
    calls,
    async send(input) {
      record('send', input);
      return { sessionId: input.sessionId, provider: 'claude', started: true };
    },
    async abort(sessionId) {
      record('abort', sessionId);
      return { sessionId, aborted: true };
    },
    events(sessionId, afterSeq) {
      record('events', sessionId, afterSeq);
      return [];
    },
    status(sessionId) {
      record('status', sessionId);
      return { sessionId, isProcessing: false, lastSeq: 0, provider: null };
    },
    pendingApprovals(sessionId) {
      record('pendingApprovals', sessionId);
      return [];
    },
    approveTool(input) {
      record('approveTool', input);
      return { requestId: input.requestId, resolved: true };
    },
    ...overrides,
  };
}

export function createFakeShellRunner(): ShellRunner & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async exec(input) {
      calls.push(input);
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, truncated: false };
    },
  };
}

export function createFakeToolContext(options: { projectPaths?: Record<string, string> } = {}): ToolContext & {
  api: RecordingDispatcher;
  chat: ReturnType<typeof createFakeChatGateway>;
  shell: ReturnType<typeof createFakeShellRunner>;
} {
  const projectPaths = options.projectPaths ?? { p1: '/tmp/project-one' };
  return {
    api: createRecordingDispatcher(),
    chat: createFakeChatGateway(),
    shell: createFakeShellRunner(),
    user: { id: 1, username: 'smoke' },
    async resolveProjectPath(projectId: string) {
      return projectPaths[projectId] ?? null;
    },
  };
}

/** Runs a tool by name against a fake context and returns the single recorded REST request. */
export async function runToolAndCapture(
  definitions: Array<{ name: string; run(args: JsonObject, ctx: ToolContext): Promise<unknown> }>,
  name: string,
  args: JsonObject,
  ctx = createFakeToolContext(),
): Promise<{ request: RestRequest | undefined; result: unknown; ctx: ReturnType<typeof createFakeToolContext> }> {
  const definition = definitions.find((entry) => entry.name === name);
  if (!definition) {
    throw new Error(`No tool named ${name}`);
  }
  const result = await definition.run(args, ctx);
  return { request: ctx.api.calls[0], result, ctx };
}
