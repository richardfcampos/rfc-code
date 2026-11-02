/**
 * Shared harness for the chat gateway tests: an isolated database for the run
 * registry, session rows, a permissive org policy and scripted runtimes.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';

import { closeConnection, initializeDatabase, type SessionRow } from '@/modules/database/index.js';
import type { OrgPolicyService } from '@/modules/orgs/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

import { createChatGateway, type ChatGatewayDeps } from '../../chat-gateway.js';

export type Writer = { send(message: Record<string, unknown>): void };
type SpawnCall = { command: string; options: Record<string, unknown>; writer: Writer };

/**
 * The registry writes run markers and failures to the database; an isolated
 * file keeps those writes away from any real database on this machine.
 */
export function useIsolatedDatabase(): void {
  let tempDirectory = '';
  const previousDatabasePath = process.env.DATABASE_PATH;
  before(async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'grokbot-chat-gateway-'));
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
  });
  after(async () => {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  });
}

export function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  const base = { session_id: `grokbot-${randomUUID()}`, provider: 'claude', provider_session_id: null, project_path: '/tmp' };
  return { ...base, worktree_path: null, profile_id: null, caveman_mode: null, ...overrides } as SessionRow;
}

export const openPolicy: OrgPolicyService = {
  assertProfileAllowed() {},
  listAllowedProfiles: () => ({ profiles: [], policyManaged: false }) as unknown as ReturnType<OrgPolicyService['listAllowedProfiles']>,
  resolveProfileForSpawn: async () => ({ profileId: 'x', role: 'primary' }),
};

export function emit(writer: Writer, kind: string, extra: Record<string, unknown> = {}): void {
  writer.send({ id: randomUUID(), kind, sessionId: 'provider-id', provider: 'claude', timestamp: new Date().toISOString(), ...extra });
}

/** A runtime that finishes immediately with one assistant text frame. */
export async function answeringSpawn(_command: string, _options: Record<string, unknown>, writer: unknown): Promise<void> {
  for (const [kind, extra] of [['text', { role: 'assistant', content: 'hello from the agent' }], ['complete', { exitCode: 0 }]] as const) {
    emit(writer as Writer, kind, extra);
  }
}

export function setup(row: SessionRow, overrides: Partial<ChatGatewayDeps> = {}) {
  const spawnCalls: SpawnCall[] = [];
  let release: () => void = () => {};
  const hangingSpawn = (command: string, options: Record<string, unknown>, writer: unknown) => {
    spawnCalls.push({ command, options, writer: writer as Writer });
    return new Promise<void>((resolve) => { release = resolve; });
  };
  const deps: ChatGatewayDeps = {
    spawnFns: { claude: hangingSpawn },
    abortFns: {},
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    getSession: (id) => (id === row.session_id ? row : null),
    policy: openPolicy,
    ...overrides,
  };
  return { gateway: createChatGateway(deps), spawnCalls, release: () => release() };
}
