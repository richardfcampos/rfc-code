/**
 * Minimal JSON-RPC client of the Grokbot MCP endpoint. The transport is
 * stateless (no `initialize` handshake, no session id), so one `tools/call`
 * per command is the whole protocol. A tool that refuses an action comes back
 * as `isError` inside a successful RPC; both that and a JSON-RPC `error` are
 * surfaced as `RfcToolError` so the entrypoint prints them the same way.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type RfcClientOptions = {
  url: string;
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
};

export type RfcClient = {
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
};

export class RfcToolError extends Error {
  constructor(readonly tool: string, message: string) {
    super(message);
    this.name = 'RfcToolError';
  }
}

export class RfcTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RfcTransportError';
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;

type RpcEnvelope = {
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  error?: { code?: number; message?: string };
};

function parseToolText(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createRfcClient(options: RfcClientOptions): RfcClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = `${options.url.replace(/\/+$/, '')}/api/grokbot-mcp`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let nextId = 0;

  async function post(body: unknown): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return { status: response.status, text: await response.text() };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'AbortError') throw new RfcTransportError(`Request to ${endpoint} timed out after ${timeoutMs} ms.`);
      const detail = error instanceof Error ? error.message : String(error);
      throw new RfcTransportError(`Could not reach ${endpoint}: ${detail}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    nextId += 1;
    const { status, text } = await post({ jsonrpc: '2.0', id: nextId, method: 'tools/call', params: { name, arguments: args } });
    if (status === 401 || status === 403) {
      throw new RfcTransportError(`Server refused the API key (HTTP ${status}). Check RFC_API_KEY or ~/.rfc-code/rfc-cli.json.`);
    }
    let envelope: RpcEnvelope;
    try {
      envelope = JSON.parse(text) as RpcEnvelope;
    } catch {
      throw new RfcTransportError(`HTTP ${status}: non-JSON response from ${endpoint}.`);
    }
    if (status !== 200) {
      throw new RfcTransportError(`HTTP ${status}: ${envelope.error?.message ?? text.slice(0, 300)}`);
    }
    if (envelope.error) {
      throw new RfcToolError(name, `${envelope.error.message ?? 'JSON-RPC error'} (code ${envelope.error.code ?? '?'})`);
    }
    const result = envelope.result ?? {};
    const toolText = result.content?.find((entry) => entry.type === 'text')?.text ?? '';
    if (result.isError) throw new RfcToolError(name, toolText || `${name} failed.`);
    return parseToolText(toolText);
  }

  return { callTool };
}
