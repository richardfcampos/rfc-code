import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  notificationChannelEndpointsDb,
  projectsDb,
  sessionWebhookDeliveriesDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';

import {
  configureSessionWebhookDispatcher,
  dispatchSessionWebhookTransition,
  sendSessionWebhookTest,
} from './session-webhook-dispatcher.service.js';
import { verifySessionWebhookSignature } from './session-webhook-signature.js';

type Call = { url: string; headers: Record<string, string>; body: string };

function fakeFetch(statuses: Array<number | 'throw'>, calls: Call[]): typeof fetch {
  let index = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body) });
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    if (status === 'throw') throw new TypeError('fetch failed');
    return new Response(null, { status });
  }) as typeof fetch;
}

async function withIsolatedDatabase(runTest: (userId: number) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-webhook-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    const userId = Number(userDb.createUser('owner', 'hash').id);
    await runTest(userId);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function seedSession(sessionId = 'sess-1'): { projectId: string; projectPath: string } {
  const projectPath = '/workspace/demo-project';
  const created = projectsDb.createProjectPath(projectPath, null);
  sessionsDb.createAppSession(sessionId, 'claude', projectPath);
  return { projectId: created.project!.project_id, projectPath };
}

function seedEndpoint(userId: number, endpointId: string, metadata: Record<string, unknown>, enabled = true): void {
  notificationChannelEndpointsDb.upsertEndpoint({
    userId,
    channel: 'session_webhook',
    endpointId,
    metadata: { url: `https://hooks.example/${endpointId}`, secret: `secret-${endpointId}`, ...metadata },
    enabled,
  });
}

const SUMMARY = { sessionId: 'sess-1', status: 'idle', response: 'all done' } as never;
const sleeps: number[] = [];
const noSleep = async (ms: number): Promise<void> => {
  sleeps.push(ms);
};

function configure(fetchImpl: typeof fetch, buildSummary = async () => SUMMARY): void {
  sleeps.length = 0;
  configureSessionWebhookDispatcher({ buildSummary, fetch: fetchImpl, sleep: noSleep, now: () => new Date('2026-11-04T12:00:00.000Z') });
}

const transition = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'sess-1',
  provider: 'claude',
  status: 'idle' as const,
  startedAt: '2026-11-04T11:55:00.000Z',
  finishedAt: '2026-11-04T11:59:00.000Z',
  lastSeq: 42,
  ...overrides,
});

test('a failing endpoint is retried with backoff and every attempt is logged without the secret', async () => {
  await withIsolatedDatabase(async (userId) => {
    const { projectId, projectPath } = seedSession();
    seedEndpoint(userId, 'james', {});
    const calls: Call[] = [];
    configure(fakeFetch(['throw', 500, 200], calls));

    await dispatchSessionWebhookTransition(transition());

    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [1000, 4000]);
    const rows = sessionWebhookDeliveriesDb.list({ endpointId: 'james' });
    assert.deepEqual(rows.map((r) => [r.attempt, r.ok, r.http_status]), [[3, 1, 200], [2, 0, 500], [1, 0, null]]);
    assert.match(rows[2]?.error ?? '', /fetch failed/);
    assert.equal(rows[1]?.error, 'HTTP 500');
    assert.equal(new Set(rows.map((r) => r.delivery_id)).size, 1);
    assert.equal(JSON.stringify(rows).includes('secret-james'), false);

    const [first] = calls;
    assert.equal(first?.url, 'https://hooks.example/james');
    assert.equal(first?.headers['X-RFC-Event'], 'session.idle');
    assert.equal(first?.headers['X-RFC-Delivery'], rows[0]?.delivery_id);
    assert.equal(verifySessionWebhookSignature('secret-james', first!.body, first!.headers['X-RFC-Signature']!), true);
    assert.equal(verifySessionWebhookSignature('wrong', first!.body, first!.headers['X-RFC-Signature']!), false);
    assert.equal(first?.body.includes('secret-james'), false);

    const payload = JSON.parse(first!.body);
    assert.equal(payload.event, 'session.idle');
    assert.equal(payload.sessionId, 'sess-1');
    assert.equal(payload.status, 'idle');
    assert.equal(payload.lastSeq, 42);
    assert.equal(payload.sentAt, '2026-11-04T12:00:00.000Z');
    assert.deepEqual(payload.project, { id: projectId, name: 'demo-project', path: projectPath });
    assert.equal(payload.deliveryId, rows[0]?.delivery_id);
    assert.deepEqual(payload.summary, SUMMARY);
  });
});

test('three failures give up with three logged attempts, the last not ok', async () => {
  await withIsolatedDatabase(async (userId) => {
    seedSession();
    seedEndpoint(userId, 'down', {});
    const calls: Call[] = [];
    configure(fakeFetch([503], calls));

    await dispatchSessionWebhookTransition(transition({ status: 'error', error: 'boom' }));

    assert.equal(calls.length, 3);
    const rows = sessionWebhookDeliveriesDb.list({ sessionId: 'sess-1' });
    assert.equal(rows.length, 3);
    assert.equal(rows[0]?.attempt, 3);
    assert.equal(rows[0]?.ok, 0);
    assert.equal(rows[0]?.event, 'session.error');
    assert.equal(JSON.parse(calls[0]!.body).error, 'boom');
  });
});

test('filters on event, project and session pick the endpoints; disabled ones never fire', async () => {
  await withIsolatedDatabase(async (userId) => {
    const { projectId } = seedSession();
    seedEndpoint(userId, 'only-errors', { events: ['session.error'] });
    seedEndpoint(userId, 'this-project', { projects: [projectId] });
    seedEndpoint(userId, 'other-project', { projects: ['nope'] });
    seedEndpoint(userId, 'this-session', { sessions: ['sess-1'] });
    seedEndpoint(userId, 'other-session', { sessions: ['sess-2'] });
    seedEndpoint(userId, 'disabled', {}, false);
    const calls: Call[] = [];
    configure(fakeFetch([204], calls));

    await dispatchSessionWebhookTransition(transition());

    assert.deepEqual(calls.map((c) => c.url).sort(), ['https://hooks.example/this-project', 'https://hooks.example/this-session']);
  });
});

test('a summary builder failure sends the payload with summary null and the session never sees an error', async () => {
  await withIsolatedDatabase(async (userId) => {
    seedSession();
    seedEndpoint(userId, 'james', {});
    const calls: Call[] = [];
    configure(fakeFetch([200], calls), async () => {
      throw new Error('summary exploded');
    });

    await assert.doesNotReject(dispatchSessionWebhookTransition(transition({ status: 'waiting_approval', requestId: 'req-1', finishedAt: null })));
    const payload = JSON.parse(calls[0]!.body);
    assert.equal(payload.summary, null);
    assert.equal(payload.event, 'session.waiting_approval');
    assert.equal(payload.requestId, 'req-1');
  });
});

test('the test send goes through the same path and reports the outcome', async () => {
  await withIsolatedDatabase(async (userId) => {
    seedEndpoint(userId, 'james', {});
    const calls: Call[] = [];
    configure(fakeFetch([500, 200], calls));

    const result = await sendSessionWebhookTest(userId, 'james');
    assert.equal(result.ok, true);
    assert.equal('attempts' in result && result.attempts, 2);
    assert.equal('lastStatus' in result && result.lastStatus, 200);
    assert.equal(calls[0]?.headers['X-RFC-Event'], 'session.test');
    assert.equal(JSON.parse(calls[0]!.body).event, 'session.test');
    assert.equal(sessionWebhookDeliveriesDb.list({ endpointId: 'james' }).length, 2);

    assert.deepEqual(await sendSessionWebhookTest(userId, 'missing'), { ok: false, error: 'ENDPOINT_NOT_FOUND' });
  });
});
