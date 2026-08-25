/**
 * The stdio MCP server is the only thing an agent actually sees, and it declares
 * its tools as a literal that has no compiler link to the dispatch behind it.
 * That duplication is deliberate — the descriptions and JSON schemas are written
 * for a model to read and do not exist in the module — but it means a tool added
 * to the REST dispatch can stay invisible to every agent until someone notices.
 *
 * So the parity is asserted instead of assumed, over the real transport: the
 * server is spawned, spoken to in newline-delimited JSON-RPC, and its answer to
 * `tools/list` is compared to the dispatch's own list of tool names.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { AGENT_BRIDGE_TOOL_NAMES } from '@/modules/agent-bridge/agent-bridge.tools.js';

const SERVER_PATH = fileURLToPath(new URL('./agent-bridge-mcp.ts', import.meta.url));
/** Generous: it covers a cold tsx compile of the server, not a model call. */
const SPAWN_TIMEOUT_MS = 60_000;

type JsonRpcResponse = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

type ToolDeclaration = {
  name: string;
  description: string;
  inputSchema: { type?: string; properties?: Record<string, unknown>; required?: string[] };
};

/**
 * Sends a batch of requests to a fresh server and collects the replies.
 *
 * stdin is closed right after writing: the server has no state of its own, so
 * the run is over once the requests are answered, and closing is what ends it.
 */
async function askServer(requests: Record<string, unknown>[]): Promise<JsonRpcResponse[]> {
  const child = spawn(process.execPath, ['--import', 'tsx', SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // No token on purpose: `tools/list` needs none, and an absent one keeps a
    // stray `tools/call` from ever reaching a real server.
    env: { ...process.env, CLOUDCLI_AGENT_BRIDGE_TOKEN: '' },
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => stdout.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => stderr.push(chunk));

  const killTimer = setTimeout(() => child.kill('SIGKILL'), SPAWN_TIMEOUT_MS);

  try {
    child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');

    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, 0, `the MCP server exited with ${String(code)}: ${stderr.join('')}`);
  } finally {
    clearTimeout(killTimer);
  }

  return stdout
    .join('')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as JsonRpcResponse);
}

test('the stdio MCP server declares exactly the tools the bridge dispatch runs', async () => {
  const [initialize, list, unsupported] = await askServer([
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'nonsense/method' },
  ]);

  assert.equal(initialize.result?.protocolVersion, '2024-11-05');

  const tools = (list.result?.tools ?? []) as ToolDeclaration[];
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...AGENT_BRIDGE_TOOL_NAMES],
    'the declared tools drifted from the dispatch; agents can only call what is declared here',
  );

  for (const tool of tools) {
    assert.ok(tool.description.trim(), `${tool.name} has no description for the model to read`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} must take an object`);
    for (const required of tool.inputSchema.required ?? []) {
      assert.ok(
        tool.inputSchema.properties?.[required],
        `${tool.name} requires "${required}" but never declares it`,
      );
    }
  }

  // An unknown method is refused rather than answered with an empty result: a
  // silent success would look to the runtime like the call went through.
  assert.ok(unsupported.error?.message?.includes('nonsense/method'));
});
