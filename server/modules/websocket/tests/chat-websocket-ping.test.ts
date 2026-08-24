import assert from 'node:assert/strict';
import test from 'node:test';

import type { WebSocket } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AnyRecord, AuthenticatedWebSocketRequest, LLMProvider } from '@/shared/types.js';

type MessageHandler = (rawMessage: unknown) => void | Promise<void>;

/**
 * Same websocket stand-in as chat-websocket-dispatch.test.ts, trimmed to what
 * the `chat.ping` liveness probe needs — no database is touched by this path.
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
}

function connectSocket(): FakeSocket {
  const providers: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];
  const spawnFn = async () => undefined;
  const abortFn = () => true;
  const spawnFns = Object.fromEntries(
    providers.map((provider) => [provider, spawnFn]),
  ) as Record<LLMProvider, typeof spawnFn>;
  const abortFns = Object.fromEntries(
    providers.map((provider) => [provider, abortFn]),
  ) as Record<LLMProvider, typeof abortFn>;

  const socket = new FakeSocket();
  handleChatConnection(
    socket as unknown as WebSocket,
    { user: { id: 'user-1' } } as AuthenticatedWebSocketRequest,
    {
      spawnFns,
      abortFns,
      resolveToolApproval: () => undefined,
      getPendingApprovalsForSession: () => [],
    },
  );

  return socket;
}

test('chat.ping replies with a chat_pong frame', async () => {
  const socket = connectSocket();
  try {
    await socket.receive({ type: 'chat.ping' });

    assert.equal(socket.frames.length, 1);
    assert.equal(socket.frames[0]?.kind, 'chat_pong');
    assert.equal(typeof socket.frames[0]?.timestamp, 'string');
  } finally {
    connectedClients.clear();
  }
});
