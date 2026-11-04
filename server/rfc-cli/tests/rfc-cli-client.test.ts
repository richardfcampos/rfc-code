import assert from 'node:assert/strict';
import test from 'node:test';

import { createRfcClient, RfcToolError, RfcTransportError, type FetchLike } from '../rfc-cli-client.js';

type Captured = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, captured: Captured[] = []): FetchLike {
  return async (url, init) => {
    captured.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
}

const rpcResult = (text: string, isError = false) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }], ...(isError ? { isError } : {}) } });

test('posts a tools/call with the bearer key and parses the JSON text result', async () => {
  const captured: Captured[] = [];
  const client = createRfcClient({ url: 'http://localhost:7799/', apiKey: 'ck_secret', fetch: fakeFetch(200, rpcResult('{"lastSeq":7}'), captured) });
  const result = await client.callTool('session_status', { sessionId: 's1' });
  assert.deepEqual(result, { lastSeq: 7 });
  assert.equal(captured[0].url, 'http://localhost:7799/api/grokbot-mcp');
  const headers = captured[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer ck_secret');
  const body = JSON.parse(String(captured[0].init.body));
  assert.equal(body.method, 'tools/call');
  assert.deepEqual(body.params, { name: 'session_status', arguments: { sessionId: 's1' } });
});

test('non-JSON tool text is returned as a string', async () => {
  const client = createRfcClient({ url: 'http://x', apiKey: 'k', fetch: fakeFetch(200, rpcResult('plain text')) });
  assert.equal(await client.callTool('shell_exec'), 'plain text');
});

test('isError results become RfcToolError carrying the tool text', async () => {
  const client = createRfcClient({ url: 'http://x', apiKey: 'k', fetch: fakeFetch(200, rpcResult('404 SESSION_NOT_FOUND: nope', true)) });
  await assert.rejects(client.callTool('session_summary', { sessionId: 'x' }), (error: unknown) => {
    assert.ok(error instanceof RfcToolError);
    assert.equal(error.tool, 'session_summary');
    assert.equal(error.message, '404 SESSION_NOT_FOUND: nope');
    return true;
  });
});

test('JSON-RPC errors become RfcToolError with the code', async () => {
  const client = createRfcClient({ url: 'http://x', apiKey: 'k', fetch: fakeFetch(200, { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'sessionId is required.' } }) });
  await assert.rejects(client.callTool('session_status', {}), /sessionId is required\. \(code -32602\)/);
});

test('401 is a transport error that points at the key without printing it', async () => {
  const client = createRfcClient({ url: 'http://x', apiKey: 'ck_do_not_print', fetch: fakeFetch(401, { error: 'unauthorized' }) });
  await assert.rejects(client.callTool('ping'), (error: unknown) => {
    assert.ok(error instanceof RfcTransportError);
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /ck_do_not_print/);
    return true;
  });
});

test('a timeout aborts the request and reports it', async () => {
  const hanging: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  const client = createRfcClient({ url: 'http://x', apiKey: 'k', fetch: hanging, timeoutMs: 20 });
  await assert.rejects(client.callTool('ping'), /timed out after 20 ms/);
});

test('a connection failure is a transport error', async () => {
  const failing: FetchLike = async () => {
    throw new TypeError('fetch failed');
  };
  const client = createRfcClient({ url: 'http://x', apiKey: 'k', fetch: failing });
  await assert.rejects(client.callTool('ping'), /Could not reach http:\/\/x\/api\/grokbot-mcp: fetch failed/);
});
