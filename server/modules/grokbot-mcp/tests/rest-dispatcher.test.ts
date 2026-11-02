import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import multer from 'multer';

import { createRestDispatcher, RestError, type RestDispatcherDeps } from '@/modules/grokbot-mcp/rest-dispatcher.js';

const sseState = { closed: false };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function buildFixtureApp(): express.Express {
  const app = express();
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage() });

  app.get('/api/envelope', (_req, res) => res.json({ success: true, data: { id: 7 } }));
  app.get('/api/envelope-extra', (_req, res) => res.json({ success: true, data: [1], total: 1 }));
  app.get('/api/raw', (_req, res) => res.json({ projects: ['a'] }));
  app.get('/api/w-error', (_req, res) =>
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task missing', details: { id: 'x' } } }),
  );
  app.get('/api/raw-error', (_req, res) => res.status(500).json({ error: 'x' }));
  app.get('/api/soft-fail', (_req, res) => res.json({ success: false, error: 'nope', statusCode: 409 }));
  app.get('/api/legacy', (_req, res) => res.json({ error: 'Not a git repository' }));
  app.delete('/api/empty', (_req, res) => res.status(204).end());
  app.all('/api/echo', (req, res) =>
    res.json({ method: req.method, headers: req.headers, query: req.query, body: req.body }),
  );
  app.post('/api/upload', upload.array('files'), (req, res) => {
    const files = (req.files as Express.Multer.File[]).map((file) => ({
      field: file.fieldname,
      name: file.originalname,
      mime: file.mimetype,
      base64: file.buffer.toString('base64'),
    }));
    res.json({ success: true, data: { fields: req.body, files, contentType: req.headers['content-type'] } });
  });
  app.get('/api/bytes', (_req, res) => res.type('image/png').send(PNG));
  app.get('/api/bytes-missing', (_req, res) => res.status(404).json({ success: false, error: { code: 'NO_FILE', message: 'gone' } }));
  app.get('/api/sse', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('data: {"type":"progress","n":1}\n\n');
    res.write('event: tick\ndata: {"type":"progress","n":2}\n\n');
    res.write(': comment\ndata: plain text\n\n');
    res.write('data: {"type":"complete","path":"/p"}\n\n');
    // Never ends on its own: the dispatcher must hang up once the predicate matches.
    const timer = setInterval(() => res.write('data: {"type":"late"}\n\n'), 50);
    req.on('close', () => {
      clearInterval(timer);
      sseState.closed = true;
    });
  });
  app.get('/api/hang', () => undefined);
  return app;
}

type Fixture = { baseUrl: string; deps: RestDispatcherDeps };

async function withServer(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const server = buildFixtureApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await run({
      baseUrl,
      deps: { resolveBaseUrl: () => baseUrl, mintToken: () => 'jwt-123', extraHeaders: () => ({ 'x-api-key': 'k-1' }) },
    });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

async function expectRestError(promise: Promise<unknown>, expected: Partial<RestError>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof RestError, `expected RestError, got ${String(error)}`);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(error[key as keyof RestError], value, key);
    return true;
  });
}

test('unwraps the success envelope, keeps RAW and extra-key bodies as-is, maps 204 to null', async () => {
  await withServer(async ({ deps }) => {
    const api = createRestDispatcher(deps);
    assert.deepEqual(await api.dispatch({ method: 'GET', path: '/api/envelope' }), { id: 7 });
    assert.deepEqual(await api.dispatch({ method: 'GET', path: '/api/envelope-extra' }), { success: true, data: [1], total: 1 });
    assert.deepEqual(await api.dispatch({ method: 'GET', path: '/api/raw' }), { projects: ['a'] });
    assert.equal(await api.dispatch({ method: 'DELETE', path: '/api/empty' }), null);
  });
});

test('folds envelope, RAW, soft-fail and legacy errors into RestError', async () => {
  await withServer(async ({ deps }) => {
    const api = createRestDispatcher(deps);
    await expectRestError(api.dispatch({ method: 'GET', path: '/api/w-error' }), {
      status: 404, code: 'NOT_FOUND', message: 'Task missing', details: { id: 'x' },
    });
    await expectRestError(api.dispatch({ method: 'GET', path: '/api/raw-error' }), { status: 500, code: 'HTTP_500', message: 'x' });
    await expectRestError(api.dispatch({ method: 'GET', path: '/api/soft-fail' }), { status: 409, code: 'HTTP_409', message: 'nope' });
    await expectRestError(api.dispatch({ method: 'GET', path: '/api/legacy' }), {
      status: 400, code: 'LEGACY_ERROR', message: 'Not a git repository',
    });
  });
});

test('sends bearer token, extra headers, encoded query and JSON bodies (DELETE included)', async () => {
  await withServer(async ({ deps }) => {
    const api = createRestDispatcher(deps);
    const echo = (await api.dispatch({
      method: 'DELETE',
      path: '/api/echo',
      query: { 'a b&c': 'x y&z', flag: true, n: 3, skip: undefined },
      body: { path: '/tmp/a.txt' },
    })) as { method: string; headers: Record<string, string>; query: Record<string, string>; body: unknown };
    assert.equal(echo.method, 'DELETE');
    assert.equal(echo.headers.authorization, 'Bearer jwt-123');
    assert.equal(echo.headers['x-api-key'], 'k-1');
    assert.equal(echo.headers['content-type'], 'application/json');
    assert.deepEqual(echo.query, { 'a b&c': 'x y&z', flag: 'true', n: '3' });
    assert.deepEqual(echo.body, { path: '/tmp/a.txt' });
  });
});

test('builds multipart/form-data with fields and decoded files', async () => {
  await withServer(async ({ deps }) => {
    const api = createRestDispatcher(deps);
    const content = Buffer.from('hello world');
    const result = (await api.dispatch({
      method: 'POST',
      path: '/api/upload',
      multipart: {
        fields: { taskId: 't1' },
        files: [{ field: 'files', fileName: 'note.txt', contentBase64: content.toString('base64'), mimeType: 'text/plain' }],
      },
    })) as { fields: Record<string, string>; files: Array<Record<string, string>>; contentType: string };
    assert.match(result.contentType, /^multipart\/form-data; boundary=/);
    assert.deepEqual({ ...result.fields }, { taskId: 't1' });
    assert.deepEqual(result.files, [{ field: 'files', name: 'note.txt', mime: 'text/plain', base64: content.toString('base64') }]);
  });
});

test('returns bytes as base64, caps at maxBytes and reports errors', async () => {
  await withServer(async ({ deps }) => {
    const full = await createRestDispatcher(deps).dispatch({ method: 'GET', path: '/api/bytes', responseType: 'bytes' });
    assert.deepEqual(full, {
      contentBase64: PNG.toString('base64'), mimeType: 'image/png', size: PNG.length, truncated: false, contentLength: PNG.length,
    });

    const capped = createRestDispatcher({ ...deps, maxBytes: 4 });
    const cut = await capped.dispatch({ method: 'GET', path: '/api/bytes', responseType: 'bytes' });
    assert.deepEqual(cut, {
      contentBase64: PNG.subarray(0, 4).toString('base64'), mimeType: 'image/png', size: PNG.length, truncated: true, contentLength: PNG.length,
    });

    await expectRestError(capped.dispatch({ method: 'GET', path: '/api/bytes-missing', responseType: 'bytes' }), {
      status: 404, code: 'NO_FILE', message: 'gone',
    });
  });
});

test('collects SSE events until the predicate matches, then hangs up', async () => {
  await withServer(async ({ deps }) => {
    const result = (await createRestDispatcher(deps).dispatch({
      method: 'GET',
      path: '/api/sse',
      responseType: 'sse',
      timeoutMs: 5_000,
      sseUntil: (event) => event.type === 'complete',
    })) as { events: unknown[] };
    assert.deepEqual(result.events, [
      { event: 'message', type: 'progress', n: 1 },
      { event: 'tick', type: 'progress', n: 2 },
      { event: 'message', data: 'plain text' },
      { event: 'message', type: 'complete', path: '/p' },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sseState.closed, true, 'server should see the client hang up');
  });
});

test('maps a hung route to 504 and an unreachable server to 503', async () => {
  await withServer(async ({ deps }) => {
    const api = createRestDispatcher(deps);
    await expectRestError(api.dispatch({ method: 'GET', path: '/api/hang', timeoutMs: 200 }), {
      status: 504, code: 'LOOPBACK_TIMEOUT',
    });
  });
  const dead = createRestDispatcher({ resolveBaseUrl: () => 'http://127.0.0.1:1', mintToken: () => 'jwt' });
  await expectRestError(dead.dispatch({ method: 'GET', path: '/api/raw' }), { status: 503, code: 'LOOPBACK_UNREACHABLE' });
});
