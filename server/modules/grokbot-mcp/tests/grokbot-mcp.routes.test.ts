import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { MCP_PROTOCOL_VERSION } from '@/modules/grokbot-mcp/grokbot-mcp.jsonrpc.js';
import { createGrokbotMcpRouter, grokbotJsonRpcErrorHandler, type GrokbotRouterDeps } from '@/modules/grokbot-mcp/grokbot-mcp.routes.js';
import type { GrokbotUser } from '@/modules/grokbot-mcp/grokbot-mcp.types.js';
import { createToolRegistry } from '@/modules/grokbot-mcp/tools/index.js';
import { S, schema, str, tool } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { createFakeToolContext } from './support/fake-tool-context.js';

const GOOD_KEY = 'ck_good';
const USER: GrokbotUser = { id: 7, username: 'grok' };

const echoTool = tool({
  name: 'test_echo',
  description: 'Echoes the given text back, for transport tests.',
  inputSchema: schema({ text: S.string('Text to echo.') }, ['text']),
  covers: [],
  run: async (args) => ({ echoed: str(args, 'text') }),
});

type RpcBody = { jsonrpc: string; id: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };

function createDeps() {
  const contextUsers: GrokbotUser[] = [];
  return {
    contextUsers,
    deps: {
      validateApiKey: (key: string) => (key === GOOD_KEY ? USER : undefined),
      registry: createToolRegistry([echoTool]),
      createContext: (user: GrokbotUser) => {
        contextUsers.push(user);
        return createFakeToolContext();
      },
    },
  };
}

/** `globalJson` mirrors the server, whose JSON parser runs before any router. */
async function withServer(
  run: (baseUrl: string) => Promise<void>,
  options: { globalJson?: boolean; deps?: GrokbotRouterDeps } = {},
): Promise<void> {
  const app = express();
  const router = createGrokbotMcpRouter(options.deps ?? createDeps().deps);
  if (options.globalJson ?? true) {
    app.use(express.json());
    app.use('/mcp', router, grokbotJsonRpcErrorHandler);
  } else {
    app.use('/mcp', router);
  }

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}/mcp`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function post(url: string, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${GOOD_KEY}` }) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };

test('missing or wrong API key is a 401 JSON-RPC error; x-api-key is accepted', async () => {
  await withServer(async (url) => {
    const missing = await post(url, INIT, {});
    assert.equal(missing.status, 401);
    const body = (await missing.json()) as RpcBody;
    assert.deepEqual([body.jsonrpc, body.id, body.error?.code], ['2.0', null, -32001]);
    assert.match(body.error?.message ?? '', /Settings > API Tokens/);

    const wrong = await post(url, INIT, { authorization: 'Bearer nope' });
    assert.equal(wrong.status, 401);
    assert.equal(((await wrong.json()) as RpcBody).error?.message, 'Invalid or inactive API key.');

    assert.equal((await post(url, INIT, { 'x-api-key': GOOD_KEY })).status, 200);
  });
});

test('Bearer key (case-insensitive scheme) authenticates and initialize answers the protocol version', async () => {
  const { deps, contextUsers } = createDeps();
  await withServer(
    async (url) => {
      const res = await post(url, INIT, { authorization: `bearer ${GOOD_KEY}` });
      assert.equal(res.status, 200);
      const body = (await res.json()) as RpcBody;
      assert.equal(body.id, 1);
      assert.equal(body.result?.protocolVersion, MCP_PROTOCOL_VERSION);
      assert.deepEqual(contextUsers, [USER]);
    },
    { deps },
  );
});

test('tools/list returns the registry', async () => {
  await withServer(async (url) => {
    const body = (await (await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as RpcBody;
    const tools = body.result?.tools as Array<{ name: string }>;
    assert.deepEqual(tools.map((entry) => entry.name), ['test_echo']);
  });
});

test('tools/call runs the tool', async () => {
  await withServer(async (url) => {
    const res = await post(url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'test_echo', arguments: { text: 'hi' } } });
    const body = (await res.json()) as RpcBody;
    const content = body.result?.content as Array<{ text: string }>;
    assert.deepEqual(JSON.parse(content[0].text), { echoed: 'hi' });
    assert.equal(body.result?.isError, undefined);
  });
});

test('unknown tool is -32601', async () => {
  await withServer(async (url) => {
    const res = await post(url, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as RpcBody;
    assert.equal(body.error?.code, -32601);
  });
});

test('a batch of two is answered with an array', async () => {
  await withServer(async (url) => {
    const res = await post(url, [INIT, { jsonrpc: '2.0', id: 5, method: 'ping' }]);
    const body = (await res.json()) as RpcBody[];
    assert.deepEqual(body.map((entry) => entry.id), [1, 5]);
  });
});

test('notification-only payload is 202 with an empty body', async () => {
  await withServer(async (url) => {
    const res = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.deepEqual([res.status, await res.text()], [202, '']);
  });
});

test('GET is 405 with an Allow header and DELETE is 204', async () => {
  await withServer(async (url) => {
    const headers = { authorization: `Bearer ${GOOD_KEY}` };
    const get = await fetch(url, { headers });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST, DELETE');
    assert.equal(((await get.json()) as RpcBody).error?.message, 'Streamable HTTP without SSE: use POST.');
    assert.equal((await fetch(url, { method: 'DELETE', headers })).status, 204);
  });
});

test('a body that is not JSON-RPC (no JSON content type) is -32700', async () => {
  await withServer(async (url) => {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${GOOD_KEY}` }, body: 'hello' });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as RpcBody).error?.code, -32700);
  });
});

for (const globalJson of [true, false]) {
  test(`invalid JSON is -32700 with HTTP 200 (${globalJson ? 'server-wide' : 'router'} parser)`, async () => {
    await withServer(
      async (url) => {
        const res = await post(url, '{bad');
        assert.equal(res.status, 200);
        const body = (await res.json()) as RpcBody;
        assert.deepEqual([body.id, body.error?.code], [null, -32700]);
      },
      { globalJson },
    );
  });
}

test('a crashing context factory is -32603 with HTTP 200', async () => {
  const { deps } = createDeps();
  const crashing: GrokbotRouterDeps = {
    ...deps,
    createContext: () => {
      throw new Error('boom');
    },
  };
  await withServer(
    async (url) => {
      const res = await post(url, INIT);
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as RpcBody).error?.code, -32603);
    },
    { deps: crashing },
  );
});
