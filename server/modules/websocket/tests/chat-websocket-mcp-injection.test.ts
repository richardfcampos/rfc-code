/**
 * Covers the trust boundary between a browser's `chat.send` options and the
 * provider runtime: `mcpServers` is honored from whichever caller passes it
 * (that is exactly what lets a server-spawned automation hand its own
 * session the agent-bridge tool), so it must never survive a client-supplied
 * options payload — an authenticated browser client sending one could
 * otherwise register an arbitrary stdio command for its own run.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import {
  handleChatConnection,
  stripClientSpawnOptions,
} from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AnyRecord, AuthenticatedWebSocketRequest, LLMProvider } from '@/shared/types.js';

type MessageHandler = (rawMessage: unknown) => void | Promise<void>;

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

type SpawnCall = { command: string; options: AnyRecord };

function connectSocket(): { socket: FakeSocket; spawnCalls: SpawnCall[] } {
  const spawnCalls: SpawnCall[] = [];
  const spawnFn = async (command: string, options: AnyRecord): Promise<void> => {
    spawnCalls.push({ command, options });
  };

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

  return { socket, spawnCalls };
}

async function withIsolatedDatabase(
  runTest: (tempDirectory: string) => void | Promise<void>
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-ws-mcp-injection-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest(tempDirectory);
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('stripClientSpawnOptions drops mcpServers and keeps everything else', () => {
  const stripped = stripClientSpawnOptions({
    cwd: '/repo',
    profileId: 'profile-a',
    mcpServers: { evil: { type: 'stdio', command: 'rm', args: ['-rf', '/'] } },
  });

  assert.deepEqual(stripped, { cwd: '/repo', profileId: 'profile-a' });
});

test('stripClientSpawnOptions is a no-op when there is nothing to strip', () => {
  const options = { cwd: '/repo', profileId: 'profile-a' };

  assert.deepEqual(stripClientSpawnOptions(options), options);
});

test('a client-supplied mcpServers never reaches the provider runtime through chat.send', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const projectPath = path.join(tempDirectory, 'repo');
    sessionsDb.createAppSession('app-mcp-1', 'claude', projectPath);

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-mcp-1',
      content: 'hello',
      options: {
        cwd: projectPath,
        mcpServers: {
          evil: { type: 'stdio', command: 'rm', args: ['-rf', '/'], env: {} },
        },
      },
    });

    assert.equal(spawnCalls.length, 1);
    assert.equal('mcpServers' in spawnCalls[0].options, false);
  });
});
