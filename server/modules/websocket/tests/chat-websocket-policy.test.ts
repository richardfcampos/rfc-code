import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { WebSocket } from 'ws';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  OrgPolicyError,
  type AllowedProfilesResult,
  type OrgPolicyService,
  type SpawnProfileSelection,
} from '@/modules/orgs/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AnyRecord, AuthenticatedWebSocketRequest, LLMProvider } from '@/shared/types.js';

type MessageHandler = (rawMessage: unknown) => void | Promise<void>;

/** Websocket stand-in that captures the handler `handleChatConnection` registers. */
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

interface PolicyCalls {
  asserted: { projectPath: string | null | undefined; profileId: string }[];
  listed: { projectPath: string | null | undefined; provider?: LLMProvider }[];
  resolved: { projectPath: string | null | undefined; sessionId?: string | null }[];
}

function allowedProfilesResult(
  overrides: Partial<AllowedProfilesResult> = {},
): AllowedProfilesResult {
  return {
    orgId: 'org-default',
    orgName: 'Pessoal',
    policyManaged: false,
    fallbackThreshold: 85,
    profiles: [],
    ...overrides,
  };
}

/**
 * Records what the spawn path asked the policy engine, and answers with
 * whatever the test scripted.
 */
function createFakePolicy(script: {
  assertProfileAllowed?: (profileId: string) => void;
  listAllowedProfiles?: () => AllowedProfilesResult;
  resolveProfileForSpawn?: () => Promise<SpawnProfileSelection>;
}): { policy: OrgPolicyService; calls: PolicyCalls } {
  const calls: PolicyCalls = { asserted: [], listed: [], resolved: [] };

  const policy: OrgPolicyService = {
    assertProfileAllowed: (projectPath, profileId) => {
      calls.asserted.push({ projectPath, profileId });
      script.assertProfileAllowed?.(profileId);
    },
    listAllowedProfiles: (projectPath, options) => {
      calls.listed.push({ projectPath, provider: options?.provider });
      return script.listAllowedProfiles?.() ?? allowedProfilesResult();
    },
    resolveProfileForSpawn: async (projectPath, options) => {
      calls.resolved.push({ projectPath, sessionId: options?.sessionId });
      if (!script.resolveProfileForSpawn) {
        throw new Error('Unexpected resolveProfileForSpawn call');
      }
      return script.resolveProfileForSpawn();
    },
  };

  return { policy, calls };
}

type SpawnCall = { command: string; options: AnyRecord };

function connectSocket(orgPolicy: OrgPolicyService): {
  socket: FakeSocket;
  spawnCalls: SpawnCall[];
} {
  const spawnCalls: SpawnCall[] = [];
  const spawnFn = async (command: string, options: AnyRecord): Promise<void> => {
    spawnCalls.push({ command, options });
  };

  const providers: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];
  const spawnFns = Object.fromEntries(
    providers.map((provider) => [provider, spawnFn]),
  ) as Record<LLMProvider, typeof spawnFn>;
  const abortFns = Object.fromEntries(
    providers.map((provider) => [provider, () => true]),
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
      orgPolicy,
    },
  );

  return { socket, spawnCalls };
}

async function withIsolatedDatabase(
  runTest: (tempDirectory: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-ws-policy-'));

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

/** Keeps the denial warning out of the test output while still exercising it. */
async function withSilencedWarnings<T>(run: () => Promise<T>): Promise<T> {
  const original = console.warn;
  console.warn = (): void => undefined;
  try {
    return await run();
  } finally {
    console.warn = original;
  }
}

test('a denied profile is refused before the runtime is spawned', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const projectPath = path.join(tempDirectory, 'repo');
    sessionsDb.createAppSession('app-denied', 'claude', projectPath, 'profile-blocked');

    const { policy, calls } = createFakePolicy({
      assertProfileAllowed: () => {
        throw new OrgPolicyError('Profile is not allowed in organization "Work".');
      },
    });
    const { socket, spawnCalls } = connectSocket(policy);

    await socket.receive({ type: 'chat.send', sessionId: 'app-denied', content: 'hello' });

    assert.equal(spawnCalls.length, 0);
    const errors = socket.framesOfKind('protocol_error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'ORG_POLICY_DENIED');
    assert.equal(errors[0]?.sessionId, 'app-denied');
    assert.match(String(errors[0]?.error), /not allowed in organization/);

    // The account under test is the session's own, checked against its project.
    assert.deepEqual(calls.asserted, [
      { projectPath, profileId: 'profile-blocked' },
    ]);
    assert.deepEqual(calls.resolved, []);
    // No run may be left behind, or the session shows "processing" forever.
    assert.equal(chatRunRegistry.getRun('app-denied'), undefined);
    assert.equal(chatRunRegistry.isProcessing('app-denied'), false);
  });
});

test('an allowed profile spawns unchanged, without consulting the resolver', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const projectPath = path.join(tempDirectory, 'repo');
    sessionsDb.createAppSession('app-allowed', 'claude', projectPath, 'profile-a');

    const { policy, calls } = createFakePolicy({});
    const { socket, spawnCalls } = connectSocket(policy);

    await socket.receive({ type: 'chat.send', sessionId: 'app-allowed', content: 'hello' });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.options.profileId, 'profile-a');
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
    assert.deepEqual(calls.asserted, [{ projectPath, profileId: 'profile-a' }]);
    // Quota never overrides a deliberate choice.
    assert.deepEqual(calls.resolved, []);
    assert.deepEqual(calls.listed, []);
  });
});

test('a session without a profile spawns on the one the resolver picks', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const projectPath = path.join(tempDirectory, 'repo');
    sessionsDb.createAppSession('app-resolved', 'codex', projectPath);

    const { policy, calls } = createFakePolicy({
      listAllowedProfiles: () => allowedProfilesResult({
        policyManaged: true,
        profiles: [
          { profileId: 'profile-primary', role: 'primary', priority: 0 },
          { profileId: 'profile-backup', role: 'fallback', priority: 1 },
        ],
      }),
      resolveProfileForSpawn: async () => ({
        profileId: 'profile-backup',
        role: 'fallback',
        fallback: { reason: 'primary profile is at 92% usage', primaryUsagePct: 92 },
      }),
    });
    const { socket, spawnCalls } = connectSocket(policy);

    await withSilencedWarnings(async () => {
      await socket.receive({ type: 'chat.send', sessionId: 'app-resolved', content: 'hello' });
    });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.options.profileId, 'profile-backup');
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
    assert.deepEqual(calls.asserted, []);
    assert.deepEqual(calls.listed, [{ projectPath, provider: 'codex' }]);
    assert.deepEqual(calls.resolved, [{ projectPath, sessionId: 'app-resolved' }]);
  });
});

test('a policy-managed org with nothing allowed refuses the spawn', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const projectPath = path.join(tempDirectory, 'repo');
    sessionsDb.createAppSession('app-empty-org', 'claude', projectPath);

    const { policy } = createFakePolicy({
      listAllowedProfiles: () => allowedProfilesResult({ policyManaged: true, profiles: [] }),
      resolveProfileForSpawn: async () => {
        throw new OrgPolicyError('Organization "Work" allows no profile for this project.');
      },
    });
    const { socket, spawnCalls } = connectSocket(policy);

    await socket.receive({ type: 'chat.send', sessionId: 'app-empty-org', content: 'hello' });

    assert.equal(spawnCalls.length, 0);
    const errors = socket.framesOfKind('protocol_error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'ORG_POLICY_DENIED');
    assert.equal(chatRunRegistry.isProcessing('app-empty-org'), false);
  });
});

test('an installation with no accounts and no policies keeps running on the runtime default', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const projectPath = path.join(tempDirectory, 'repo');
    sessionsDb.createAppSession('app-compat', 'claude', projectPath);

    // Nothing configured: no policies, no profiles. resolveProfileForSpawn is
    // deliberately absent from the script — calling it would fail the test.
    const { policy, calls } = createFakePolicy({
      listAllowedProfiles: () => allowedProfilesResult(),
    });
    const { socket, spawnCalls } = connectSocket(policy);

    await socket.receive({ type: 'chat.send', sessionId: 'app-compat', content: 'hello' });

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.options.profileId, null);
    assert.deepEqual(socket.framesOfKind('protocol_error'), []);
    assert.deepEqual(calls.resolved, []);
  });
});

test('a profile sent by the client is enforced when the session has none', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const projectPath = path.join(tempDirectory, 'repo');
    sessionsDb.createAppSession('app-client-profile', 'claude', projectPath);

    const { policy, calls } = createFakePolicy({
      assertProfileAllowed: () => {
        throw new OrgPolicyError('Profile "profile-x" does not exist.');
      },
    });
    const { socket, spawnCalls } = connectSocket(policy);

    await socket.receive({
      type: 'chat.send',
      sessionId: 'app-client-profile',
      content: 'hello',
      options: { profileId: 'profile-x' },
    });

    assert.equal(spawnCalls.length, 0);
    assert.equal(socket.framesOfKind('protocol_error')[0]?.code, 'ORG_POLICY_DENIED');
    assert.deepEqual(calls.asserted, [{ projectPath, profileId: 'profile-x' }]);
  });
});
