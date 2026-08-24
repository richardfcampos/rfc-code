import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { createAgentMessagesRouter } from '@/modules/agent-messages/agent-messages.routes.js';
import type { AgentMessagesService } from '@/modules/agent-messages/agent-messages.service.js';
import type { AgentMessageRow } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

const MESSAGE: AgentMessageRow = {
  message_id: 'message-1',
  from_session_id: 'session-maestro',
  to_session_id: 'session-worker',
  subject: 'Review the parser fix',
  body: 'Branch feat/parser is ready.',
  state: 'queued',
  reply_to_message_id: null,
  detail: null,
  created_at: '2026-08-20T00:00:00.000Z',
  updated_at: '2026-08-20T00:00:00.000Z',
};

type ListCall = [string, Record<string, unknown>];

function unexpected(name: string): never {
  throw new Error(`${name} must not be reachable over the read-only REST surface`);
}

/** Only `list` is wired: every other method must be unreachable from HTTP. */
function createServiceStub(calls: ListCall[]): AgentMessagesService {
  return {
    list: (sessionId, filter) => {
      calls.push([sessionId, filter as Record<string, unknown>]);
      return [MESSAGE];
    },
    send: () => unexpected('send'),
    pullInbox: () => unexpected('pullInbox'),
    acknowledge: () => unexpected('acknowledge'),
    answer: () => unexpected('answer'),
    fail: () => unexpected('fail'),
  };
}

/** Same envelope the server entrypoint's global error middleware produces. */
function attachErrorMiddleware(app: express.Express): void {
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
}

async function withServer(
  service: AgentMessagesService,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/agent-messages', createAgentMessagesRouter(service));
  attachErrorMiddleware(app);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('GET returns a session mailbox in the shared success envelope', async () => {
  const calls: ListCall[] = [];

  await withServer(createServiceStub(calls), async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/agent-messages?sessionId=session-worker&box=inbox&state=queued`,
    );
    const body = (await response.json()) as { success: boolean; data: { messages: AgentMessageRow[] } };

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.data.messages.map((row) => row.message_id), [MESSAGE.message_id]);
    assert.deepEqual(calls, [['session-worker', { box: 'inbox', state: 'queued' }]]);
  });
});

test('box and state are optional and forwarded as absent', async () => {
  const calls: ListCall[] = [];

  await withServer(createServiceStub(calls), async (baseUrl) => {
    await fetch(`${baseUrl}/api/agent-messages?sessionId=session-worker`);

    assert.deepEqual(calls, [['session-worker', { box: undefined, state: undefined }]]);
  });
});

test('a missing sessionId is a named 400 rather than a whole-installation dump', async () => {
  const calls: ListCall[] = [];

  await withServer(createServiceStub(calls), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent-messages`);
    const body = (await response.json()) as { success: boolean; error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'AGENT_MESSAGE_VALIDATION_ERROR');
    assert.equal(calls.length, 0);
  });
});

test('a validation failure from the service keeps its status and code', async () => {
  const service: AgentMessagesService = {
    ...createServiceStub([]),
    list: () => {
      throw new AppError('box must be one of: inbox, outbox', {
        code: 'AGENT_MESSAGE_VALIDATION_ERROR',
        statusCode: 400,
      });
    },
  };

  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent-messages?sessionId=s1&box=archive`);
    const body = (await response.json()) as { error: { code: string; message: string } };

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'AGENT_MESSAGE_VALIDATION_ERROR');
    assert.match(body.error.message, /inbox, outbox/);
  });
});

test('the read-only surface exposes no way to mutate a handoff', async () => {
  const calls: ListCall[] = [];

  await withServer(createServiceStub(calls), async (baseUrl) => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await fetch(`${baseUrl}/api/agent-messages`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify({ toSessionId: 's2', subject: 'x', body: 'y' }),
      });
      assert.equal(response.status, 404, `${method} must not be routed`);
    }
  });
});
