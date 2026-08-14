import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handoffService, profilesService } from '@/modules/profiles/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AnyRecord, AuthenticatedWebSocketRequest, LLMProvider } from '@/shared/types.js';

type MessageHandler = (rawMessage: unknown) => void | Promise<void>;

/**
 * Websocket stand-in that captures the handlers `handleChatConnection`
 * registers, so a test can feed it one `chat.send` and observe every frame
 * the server pushes back, including broadcasts it never asked for.
 */
class FakeSocket {
  readyState = 1; // WS_OPEN_STATE
  frames: AnyRecord[] = [];
  private messageHandler: MessageHandler | null = null;

  on(event: string, handler: MessageHandler): void {
    if (event === 'message') {
      this.messageHandler = handler;
    }
  }

  send(data: string): void {
    this.frames.push(JSON.parse(data) as AnyRecord);
  }

  async receive(payload: AnyRecord): Promise<void> {
    assert.ok(this.messageHandler, 'no message handler was registered');
    await this.messageHandler(Buffer.from(JSON.stringify(payload)));
  }

  framesOfType(type: string): AnyRecord[] {
    return this.frames.filter((frame) => frame.type === type);
  }
}

/** Wires a socket to the chat handler, dispatching every provider to a no-op spawn. */
function connectSocket(): FakeSocket {
  const spawnFn = async (): Promise<void> => undefined;

  const providers: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];
  const spawnFns = Object.fromEntries(
    providers.map((provider) => [provider, spawnFn])
  ) as Record<LLMProvider, typeof spawnFn>;
  const abortFns = Object.fromEntries(
    providers.map((provider) => [provider, () => true])
  ) as Record<LLMProvider, () => boolean>;

  const socket = new FakeSocket();
  handleChatConnection(
    socket as unknown as WebSocket,
    { user: { id: 'user-1' } } as AuthenticatedWebSocketRequest,
    {
      spawnFns,
      abortFns,
      resolveToolApproval: () => undefined,
      getPendingApprovalsForSession: () => [],
    }
  );

  return socket;
}

/**
 * Polls until `condition` holds. The switch is drained off the request path
 * on purpose (it is fire-and-forget), so tests observe its effect instead of
 * awaiting the send.
 */
async function waitUntil(condition: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for: ${description}`);
}

async function withHandoffEnvironment(
  runTest: (tempDirectory: string) => void | Promise<void>
): Promise<void> {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
  };
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-ws-handoff-broadcast-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempDirectory, 'profiles');
  await initializeDatabase();

  try {
    await runTest(tempDirectory);
  } finally {
    mock.restoreAll();
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    if (previous.PROFILES_ROOT === undefined) delete process.env.PROFILES_ROOT;
    else process.env.PROFILES_ROOT = previous.PROFILES_ROOT;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a seeded deferred switch broadcasts session.handoff, with the new session id and provider, to every connected client', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    const target = profilesService.createProfile({ provider: 'codex', name: 'Target Account' });
    sessionsDb.createAppSession('app-broadcast-1', 'claude', path.join(tempDirectory, 'repo'));

    mock.method(handoffService, 'drainPendingSwitch', async () => ({
      status: 'seeded' as const,
      sessionId: 'app-broadcast-1-seeded',
      profileId: target.id,
      primed: true,
    }));

    const sender = connectSocket();
    // A second client not involved in the request — proves the broadcast
    // reaches every connected socket, not just the one that sent the turn.
    const bystander = connectSocket();

    await sender.receive({ type: 'chat.send', sessionId: 'app-broadcast-1', content: 'go' });

    await waitUntil(
      () => sender.framesOfType('session.handoff').length > 0,
      'the deferred switch broadcast to arrive'
    );

    for (const socket of [sender, bystander]) {
      const frames = socket.framesOfType('session.handoff');
      assert.equal(frames.length, 1);
      assert.deepEqual(frames[0], {
        type: 'session.handoff',
        sessionId: 'app-broadcast-1',
        status: 'seeded',
        targetSessionId: 'app-broadcast-1-seeded',
        provider: 'codex',
        profileId: target.id,
      });
    }
  });
});

test('a transplanted deferred switch broadcasts session.handoff with targetSessionId equal to sessionId', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    const target = profilesService.createProfile({ provider: 'claude', name: 'Target Account' });
    sessionsDb.createAppSession('app-broadcast-2', 'claude', path.join(tempDirectory, 'repo'));

    mock.method(handoffService, 'drainPendingSwitch', async () => ({
      status: 'transplanted' as const,
      sessionId: 'app-broadcast-2',
      profileId: target.id,
    }));

    const socket = connectSocket();
    await socket.receive({ type: 'chat.send', sessionId: 'app-broadcast-2', content: 'go' });

    await waitUntil(
      () => socket.framesOfType('session.handoff').length > 0,
      'the deferred switch broadcast to arrive'
    );

    const [frame] = socket.framesOfType('session.handoff');
    assert.deepEqual(frame, {
      type: 'session.handoff',
      sessionId: 'app-broadcast-2',
      status: 'transplanted',
      targetSessionId: 'app-broadcast-2',
      provider: 'claude',
      profileId: target.id,
    });
  });
});

test('a drain that finds nothing queued broadcasts nothing', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    sessionsDb.createAppSession('app-broadcast-3', 'claude', path.join(tempDirectory, 'repo'));
    mock.method(handoffService, 'drainPendingSwitch', async () => null);

    const socket = connectSocket();
    await socket.receive({ type: 'chat.send', sessionId: 'app-broadcast-3', content: 'go' });

    assert.deepEqual(socket.framesOfType('protocol_error'), []);
    // Give the fire-and-forget drain a moment to settle before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(socket.framesOfType('session.handoff'), []);
  });
});

test('a broadcast failure is logged by the existing catch and never breaks the run loop', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    sessionsDb.createAppSession('app-broadcast-4', 'claude', path.join(tempDirectory, 'repo'));

    // The target profile cannot be resolved (deleted between drain and
    // broadcast, for example) — the broadcast helper throws when reading its
    // provider, and that throw must land in the deferred switch's own catch.
    mock.method(handoffService, 'drainPendingSwitch', async () => ({
      status: 'transplanted' as const,
      sessionId: 'app-broadcast-4',
      profileId: 'missing-profile',
    }));

    const loggedErrors: string[] = [];
    mock.method(console, 'error', (message: unknown) => {
      loggedErrors.push(String(message));
    });

    const socket = connectSocket();
    await socket.receive({ type: 'chat.send', sessionId: 'app-broadcast-4', content: 'go' });

    assert.deepEqual(socket.framesOfType('protocol_error'), []);
    assert.equal(chatRunRegistry.isProcessing('app-broadcast-4'), false);

    await waitUntil(
      () => loggedErrors.some((entry) => entry.includes('Deferred account switch failed')),
      'the broadcast failure to be logged instead of rejecting into the run loop'
    );
    assert.deepEqual(socket.framesOfType('session.handoff'), []);
  });
});
