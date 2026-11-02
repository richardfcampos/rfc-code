import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createRestDispatcher, RestError, type RestDispatcherDeps } from '@/modules/grokbot-mcp/rest-dispatcher.js';

const CHUNK = 16 * 1024;
const TOTAL_CHUNKS = 64; // 1 MiB in total
const state = { chunksWritten: 0, bigClosed: false, sseClosed: false, foreignHits: 0 };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function streamUntilClosed(res: express.Response, onClose: () => void, tick: () => void): void {
  const timer = setInterval(() => (res.destroyed ? undefined : tick()), 2);
  res.on('close', () => {
    clearInterval(timer);
    onClose();
  });
}

function buildFixtureApp(foreignBaseUrl: string): express.Express {
  const app = express();
  app.get('/api/big', async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(CHUNK * TOTAL_CHUNKS) });
    let closed = false;
    res.on('close', () => {
      closed = true;
      state.bigClosed = true;
    });
    // Paced writes so a client that keeps reading would see the whole MiB, while one that hangs up stops the loop.
    for (let i = 0; i < TOTAL_CHUNKS && !closed; i += 1) {
      res.write(Buffer.alloc(CHUNK, i % 256));
      state.chunksWritten += 1;
      await pause(5);
    }
    if (!closed) res.end();
  });
  app.get('/api/sse-flood', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let n = 0;
    streamUntilClosed(res, () => (state.sseClosed = true), () => res.write(`data: {"n":${(n += 1)}}\n\n`));
  });
  app.get('/api/sse-unterminated', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"n":1}\n\ndata: ');
    streamUntilClosed(res, () => (state.sseClosed = true), () => res.write('x'.repeat(512)));
  });
  app.get('/api/redirect', (_req, res) => res.redirect(302, `${foreignBaseUrl}/steal`));
  return app;
}

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function withServer(run: (deps: RestDispatcherDeps) => Promise<void>): Promise<void> {
  const foreignApp = express();
  foreignApp.all('/steal', (_req, res) => {
    state.foreignHits += 1;
    res.json({ stolen: true });
  });
  const foreign = await listen(foreignApp);
  const local = await listen(buildFixtureApp(foreign.baseUrl));
  try {
    await run({ resolveBaseUrl: () => local.baseUrl, mintToken: () => 'jwt-123', extraHeaders: () => ({ 'x-api-key': 'k-1' }) });
  } finally {
    for (const { server } of [local, foreign]) {
      server.closeAllConnections();
      server.close();
    }
  }
}

test('bytes: stops reading past maxBytes and hangs up instead of buffering the whole body', async () => {
  await withServer(async (deps) => {
    state.chunksWritten = 0;
    const maxBytes = 64 * 1024;
    const api = createRestDispatcher({ ...deps, maxBytes });
    const result = (await api.dispatch({ method: 'GET', path: '/api/big', responseType: 'bytes' })) as Record<string, unknown>;
    assert.equal(result.truncated, true);
    assert.equal(Buffer.from(result.contentBase64 as string, 'base64').length, maxBytes);
    assert.equal(result.contentLength, CHUNK * TOTAL_CHUNKS);
    assert.ok((result.size as number) > maxBytes && (result.size as number) < CHUNK * TOTAL_CHUNKS, `size ${String(result.size)}`);
    await pause(100);
    assert.equal(state.bigClosed, true, 'server should see the client hang up');
    assert.ok(state.chunksWritten < TOTAL_CHUNKS, `write loop should be interrupted, wrote ${state.chunksWritten}`);
  });
});

test('sse: stops at maxSseEvents and reports truncated', async () => {
  await withServer(async (deps) => {
    state.sseClosed = false;
    const api = createRestDispatcher({ ...deps, maxSseEvents: 5 });
    const result = await api.dispatch({ method: 'GET', path: '/api/sse-flood', responseType: 'sse', timeoutMs: 5_000 });
    assert.deepEqual(result, { events: [1, 2, 3, 4, 5].map((n) => ({ event: 'message', n })), truncated: true });
    await pause(100);
    assert.equal(state.sseClosed, true, 'server should see the client hang up');
  });
});

test('sse: stops when an unterminated frame outgrows maxSseBufferBytes', async () => {
  await withServer(async (deps) => {
    state.sseClosed = false;
    const api = createRestDispatcher({ ...deps, maxSseBufferBytes: 4096 });
    const result = await api.dispatch({ method: 'GET', path: '/api/sse-unterminated', responseType: 'sse', timeoutMs: 5_000 });
    assert.deepEqual(result, { events: [{ event: 'message', n: 1 }], truncated: true });
    await pause(100);
    assert.equal(state.sseClosed, true, 'server should see the client hang up');
  });
});

test('a 3xx is a RestError and the redirect target never sees the request', async () => {
  await withServer(async (deps) => {
    state.foreignHits = 0;
    const api = createRestDispatcher(deps);
    await assert.rejects(api.dispatch({ method: 'GET', path: '/api/redirect' }), (error: unknown) => {
      assert.ok(error instanceof RestError, `expected RestError, got ${String(error)}`);
      assert.equal(error.status, 302);
      assert.equal(error.code, 'UNEXPECTED_REDIRECT');
      return true;
    });
    await assert.rejects(api.dispatch({ method: 'GET', path: '/api/redirect', responseType: 'bytes' }), { code: 'UNEXPECTED_REDIRECT' });
    assert.equal(state.foreignHits, 0);
  });
});
