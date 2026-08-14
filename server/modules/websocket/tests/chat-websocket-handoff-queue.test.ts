import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  handoffService,
  profilesService,
  resolveProfileDir,
  switchSessionProfile,
  type ProfileView,
} from '@/modules/profiles/index.js';
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

type SpawnImplementation = (command: string, options: AnyRecord) => Promise<void>;

/** Wires a socket to the chat handler, dispatching every provider to `spawn`. */
function connectSocket(spawn: SpawnImplementation): FakeSocket {
  const providers: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];
  const spawnFns = Object.fromEntries(
    providers.map((provider) => [provider, spawn])
  ) as Record<LLMProvider, SpawnImplementation>;
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

/** A promise a test can settle by hand, used to hold a turn mid-flight. */
function createGate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * Polls until `condition` holds. The queued switch is applied off the request
 * path on purpose, so tests observe its effect rather than await the call.
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
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-ws-handoff-'));

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

const PROJECT_SEGMENT = 'proj-ws';
const TRANSCRIPT = '{"type":"user","text":"hello"}\n{"type":"assistant","text":"hi there"}\n';

/**
 * Registers an app-allocated session owned by `owner`, with a real transcript
 * laid out under that profile's store path so a same-provider switch can
 * transplant it (the observable effect a queued switch has to produce).
 */
function seedSession(sessionId: string, owner: ProfileView, projectPath: string): void {
  const sourceDir = path.join(resolveProfileDir('claude', owner.slug), 'projects', PROJECT_SEGMENT);
  fs.mkdirSync(sourceDir, { recursive: true });
  const sourceFile = path.join(sourceDir, `${sessionId}.jsonl`);
  fs.writeFileSync(sourceFile, TRANSCRIPT);

  sessionsDb.createAppSession(sessionId, 'claude', projectPath, owner.id);
  sessionsDb.updateSessionJsonlPath(sessionId, sourceFile);
}

function transplantedPath(target: ProfileView, sessionId: string): string {
  return path.join(
    resolveProfileDir('claude', target.slug),
    'projects',
    PROJECT_SEGMENT,
    `${sessionId}.jsonl`
  );
}

function createProfilePair(): { source: ProfileView; target: ProfileView } {
  return {
    source: profilesService.createProfile({ provider: 'claude', name: 'Account A' }),
    target: profilesService.createProfile({ provider: 'claude', name: 'Account B' }),
  };
}

test('a switch requested mid-turn is queued and leaves the running turn alone', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    const { source, target } = createProfilePair();
    const sessionId = 'app-handoff-1';
    seedSession(sessionId, source, path.join(tempDirectory, 'repo'));

    const gate = createGate();
    const started = createGate();
    let completedTurns = 0;
    const socket = connectSocket(async () => {
      started.open();
      await gate.promise;
      completedTurns += 1;
    });

    const sendPromise = socket.receive({
      type: 'chat.send',
      sessionId,
      content: 'keep working',
    });
    await started.promise;

    const queued = await switchSessionProfile(sessionId, target.id);

    assert.equal(queued.status, 'queued');
    assert.equal(queued.profileId, target.id);
    // Nothing may be applied while the turn streams.
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, source.id);
    assert.ok(!fs.existsSync(transplantedPath(target, sessionId)), 'no transplant mid-turn');
    assert.equal(completedTurns, 0, 'the turn is still in flight');

    gate.open();
    await sendPromise;

    // The turn ran to completion instead of being killed by the switch.
    assert.equal(completedTurns, 1);
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);

    // Let the deferred switch land before the temp directory is removed.
    await waitUntil(
      () => sessionsDb.getSessionById(sessionId)?.profile_id === target.id,
      'the deferred switch to be applied'
    );
  });
});

test('the queued switch is applied once the turn ends', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    const { source, target } = createProfilePair();
    const sessionId = 'app-handoff-2';
    seedSession(sessionId, source, path.join(tempDirectory, 'repo'));

    const gate = createGate();
    const started = createGate();
    const socket = connectSocket(async () => {
      started.open();
      await gate.promise;
    });

    const sendPromise = socket.receive({ type: 'chat.send', sessionId, content: 'go' });
    await started.promise;
    assert.equal((await switchSessionProfile(sessionId, target.id)).status, 'queued');

    gate.open();
    await sendPromise;

    await waitUntil(
      () => sessionsDb.getSessionById(sessionId)?.profile_id === target.id,
      'the session row to be repointed at the target profile'
    );
    const moved = transplantedPath(target, sessionId);
    assert.ok(fs.existsSync(moved), 'transcript transplanted into the target profile dir');
    assert.ok(fs.readFileSync(moved, 'utf8').includes('"type":"profile-switch"'));

    // The queue is emptied by the drain, so a later turn does not switch again.
    assert.equal(await handoffService.drainPendingSwitch(sessionId), null);
  });
});

test('a deferred switch that fails is logged without breaking the run loop', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    const { source } = createProfilePair();
    const sessionId = 'app-handoff-3';
    seedSession(sessionId, source, path.join(tempDirectory, 'repo'));

    const loggedErrors: string[] = [];
    mock.method(console, 'error', (message: unknown) => {
      loggedErrors.push(String(message));
    });
    mock.method(handoffService, 'drainPendingSwitch', async () => {
      throw new Error('drain exploded');
    });

    let completedTurns = 0;
    const socket = connectSocket(async () => {
      completedTurns += 1;
    });

    // The rejection must not surface as a failed send or a protocol error.
    await socket.receive({ type: 'chat.send', sessionId, content: 'go' });

    assert.equal(completedTurns, 1);
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
    assert.equal(chatRunRegistry.isProcessing(sessionId), false);
    await waitUntil(
      () => loggedErrors.some((entry) => entry.includes('Deferred account switch failed')),
      'the failed drain to be logged'
    );
  });
});

test('a turn with no queued switch completes with the session untouched', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    const { source } = createProfilePair();
    const sessionId = 'app-handoff-4';
    seedSession(sessionId, source, path.join(tempDirectory, 'repo'));
    const before = sessionsDb.getSessionById(sessionId);

    let completedTurns = 0;
    const socket = connectSocket(async () => {
      completedTurns += 1;
    });
    await socket.receive({ type: 'chat.send', sessionId, content: 'go' });

    assert.equal(completedTurns, 1);
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
    const after = sessionsDb.getSessionById(sessionId);
    assert.equal(after?.profile_id, before?.profile_id);
    assert.equal(after?.jsonl_path, before?.jsonl_path);
    assert.equal(await handoffService.drainPendingSwitch(sessionId), null);
  });
});

test('a send rejected because a run is in progress does not mark the session as running', async () => {
  await withHandoffEnvironment(async (tempDirectory) => {
    const { source, target } = createProfilePair();
    const sessionId = 'app-handoff-5';
    seedSession(sessionId, source, path.join(tempDirectory, 'repo'));

    // Claim the session from another connection, exactly as a live turn would.
    const holder = new FakeSocket();
    assert.ok(
      chatRunRegistry.startRun({
        appSessionId: sessionId,
        provider: 'claude',
        providerSessionId: null,
        connection: holder as unknown as WebSocket,
        userId: 'user-2',
      })
    );

    let spawnCalls = 0;
    const socket = connectSocket(async () => {
      spawnCalls += 1;
    });
    await socket.receive({ type: 'chat.send', sessionId, content: 'too early' });

    assert.equal(spawnCalls, 0);
    assert.equal(socket.framesOfKind('protocol_error')[0]?.code, 'RUN_IN_PROGRESS');

    // The rejected send never reaches the completion path that clears the flag,
    // so marking it as running there would queue every later switch forever.
    const result = await switchSessionProfile(sessionId, target.id);
    assert.equal(result.status, 'transplanted');
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, target.id);
  });
});
