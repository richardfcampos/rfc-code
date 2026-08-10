import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AnyRecord, AuthenticatedWebSocketRequest, LLMProvider } from '@/shared/types.js';

type MessageHandler = (rawMessage: unknown) => void | Promise<void>;

/**
 * Websocket stand-in that captures the handlers `handleChatConnection`
 * registers, so a test can feed it one `chat.send` and await the dispatch.
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

  framesOfKind(kind: string): AnyRecord[] {
    return this.frames.filter((frame) => frame.kind === kind);
  }
}

type SpawnCall = { command: string; options: AnyRecord };

/**
 * Wires a socket to the chat handler with recording runtimes for every
 * provider, so the test can assert on what the dispatch would have spawned.
 */
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
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-ws-dispatch-'));

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

test('a worktree session runs in its worktree even when the client sends a cwd', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const repoPath = path.join(tempDirectory, 'repo');
    const worktreePath = await mkdtemp(path.join(tempDirectory, 'worktree-'));
    sessionsDb.createAppSession('app-wt-1', 'claude', repoPath, null, worktreePath, 'feature/x');

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-wt-1',
      content: 'hello',
      options: { cwd: repoPath, projectPath: repoPath },
    });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.options.cwd, worktreePath);
    assert.equal(spawnCalls[0]?.options.projectPath, repoPath);
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
  });
});

test('a session without a worktree keeps following the client cwd, then the project path', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const projectPath = path.join(tempDirectory, 'plain-repo');
    const otherPath = path.join(tempDirectory, 'other-dir');
    sessionsDb.createAppSession('app-plain-1', 'codex', projectPath);

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-plain-1',
      content: 'hello',
      options: { cwd: otherPath },
    });
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-plain-1',
      content: 'hello again',
      options: {},
    });

    assert.equal(spawnCalls.length, 2);
    assert.equal(spawnCalls[0]?.options.cwd, otherPath);
    assert.equal(spawnCalls[1]?.options.cwd, projectPath);
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
  });
});

test('a session whose worktree was deleted is rejected without spawning or leaving a run behind', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const repoPath = path.join(tempDirectory, 'repo');
    const worktreePath = await mkdtemp(path.join(tempDirectory, 'removed-worktree-'));
    sessionsDb.createAppSession('app-wt-2', 'claude', repoPath, null, worktreePath, 'feature/y');
    await rm(worktreePath, { recursive: true, force: true });

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-wt-2',
      content: 'hello',
      options: { cwd: repoPath },
    });

    assert.equal(spawnCalls.length, 0);
    const errors = socket.framesOfKind('protocol_error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'WORKTREE_MISSING');
    assert.equal(errors[0]?.sessionId, 'app-wt-2');
    assert.ok(String(errors[0]?.error).includes(worktreePath));
    // No run may be left hanging, or the session would show "processing" forever.
    assert.equal(chatRunRegistry.getRun('app-wt-2'), undefined);
    assert.equal(chatRunRegistry.isProcessing('app-wt-2'), false);
  });
});
