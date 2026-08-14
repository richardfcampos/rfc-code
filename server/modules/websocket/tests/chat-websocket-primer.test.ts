import assert from 'node:assert/strict';
import fs from 'node:fs';
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

/** Wires a socket to the chat handler with recording runtimes for every provider. */
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
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-ws-primer-'));

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

const PRIMER_TEXT = [
  '# Conversation handed over from claude',
  '',
  '**User:** refactor the queue drain',
  '**Assistant:** drained it in one transaction',
].join('\n');

/**
 * Recreates what a cross-provider handoff leaves behind: a session on the
 * target provider plus a primer file the session row points at.
 */
function createSeededSession(
  sessionId: string,
  tempDirectory: string,
  primer: string | null
): string {
  sessionsDb.createAppSession(sessionId, 'codex', path.join(tempDirectory, 'repo'));
  const primerPath = path.join(tempDirectory, `${sessionId}.md`);
  if (primer !== null) {
    fs.writeFileSync(primerPath, primer, 'utf8');
  }
  sessionsDb.updateSessionSeedPrimerPath(sessionId, primerPath);
  return primerPath;
}

test('the first turn of a seeded session carries the handed-over conversation', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    createSeededSession('app-primer-1', tempDirectory, PRIMER_TEXT);

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-primer-1',
      content: 'now add a retry',
    });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.command, `${PRIMER_TEXT}\n\n---\n\nnow add a retry`);
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
  });
});

test('turns after the first send the prompt alone, with the pointer cleared', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    createSeededSession('app-primer-2', tempDirectory, PRIMER_TEXT);

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({ type: 'chat.send', sessionId: 'app-primer-2', content: 'first' });
    await socket.receive({ type: 'chat.send', sessionId: 'app-primer-2', content: 'second' });
    await socket.receive({ type: 'chat.send', sessionId: 'app-primer-2', content: 'third' });

    assert.equal(spawnCalls.length, 3);
    assert.ok(spawnCalls[0]?.command.includes(PRIMER_TEXT), 'turn one carries the context');
    assert.equal(spawnCalls[1]?.command, 'second');
    assert.equal(spawnCalls[2]?.command, 'third');
    assert.equal(sessionsDb.getSessionById('app-primer-2')?.seed_primer_path, null);
  });
});

test('a primer file that no longer exists still lets the turn through', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const primerPath = createSeededSession('app-primer-3', tempDirectory, null);
    assert.ok(!fs.existsSync(primerPath), 'the pointer refers to a file that was never written');

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-primer-3',
      content: 'carry on without context',
    });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.command, 'carry on without context');
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
    // The broken pointer is dropped, so it cannot wedge every later turn.
    assert.equal(sessionsDb.getSessionById('app-primer-3')?.seed_primer_path, null);
  });
});

test('a session that never came from a handoff dispatches the prompt verbatim', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    sessionsDb.createAppSession('app-primer-4', 'claude', path.join(tempDirectory, 'repo'));

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-primer-4',
      content: '  spaced\n\n---\n\ninput  ',
    });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.command, '  spaced\n\n---\n\ninput  ');
    assert.equal(sessionsDb.getSessionById('app-primer-4')?.seed_primer_path, null);
  });
});

test('a send rejected because a run is already in progress leaves the primer pending', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const primerPath = createSeededSession('app-primer-5', tempDirectory, PRIMER_TEXT);

    // Claim the session from another connection, exactly as a live turn would.
    const holder = new FakeSocket();
    assert.ok(
      chatRunRegistry.startRun({
        appSessionId: 'app-primer-5',
        provider: 'codex',
        providerSessionId: null,
        connection: holder as unknown as WebSocket,
        userId: 'user-2',
      })
    );

    const { socket, spawnCalls } = connectSocket();
    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-primer-5',
      content: 'too early',
    });

    assert.equal(spawnCalls.length, 0);
    assert.equal(socket.framesOfKind('protocol_error')[0]?.code, 'RUN_IN_PROGRESS');
    // Nothing was dispatched, so the context must still be waiting for a turn.
    assert.equal(sessionsDb.getSessionById('app-primer-5')?.seed_primer_path, primerPath);
  });
});
