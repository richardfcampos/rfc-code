/**
 * Covers the resume path a routed review comment takes: the bridge's stdio
 * MCP registration must reach a resumed run's options the same way it
 * reaches a brand-new spawn, or a server-owned session loses its tool
 * surface the moment it is asked to address a comment instead of started
 * fresh.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';

import {
  createSessionMessageSender,
  type AgentBridgeMcpRegistrationLike,
} from '../services/session-message-sender.service.js';

const REGISTRATION: AgentBridgeMcpRegistrationLike = {
  name: 'cloudcli-agent-bridge',
  command: 'cloudcli',
  args: ['agent-bridge-mcp'],
  env: { CLOUDCLI_AGENT_BRIDGE_TOKEN: 'fake-token' },
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-message-sender-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
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

test('a resumed turn carries the same agent-bridge mcp server a fresh spawn would', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-routed-1', 'claude', '/workspace/demo');

    const spawns: { options: Record<string, unknown> }[] = [];
    const sender = createSessionMessageSender({
      spawnFns: {
        claude: async (_command, options) => {
          spawns.push({ options });
        },
      },
      bridge: { describeRegistrationForSession: () => REGISTRATION },
    });

    const session = sessionsDb.getSessionById('app-routed-1');
    assert.ok(session);

    const delivered = await sender({ session, text: 'Please address this comment' });

    assert.equal(delivered, true);
    assert.equal(spawns.length, 1);
    const mcpServers = spawns[0].options.mcpServers as Record<string, unknown>;
    assert.ok(mcpServers, 'expected mcpServers on the resumed options');
    const server = mcpServers['cloudcli-agent-bridge'] as Record<string, unknown>;
    assert.equal(server.type, 'stdio');
    assert.equal(server.command, REGISTRATION.command);
    assert.deepEqual(server.args, REGISTRATION.args);
    assert.deepEqual(server.env, REGISTRATION.env);
  });
});

test('a session the bridge cannot resolve still gets its comment, just without the tool surface', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-routed-2', 'claude', '/workspace/demo');

    const spawns: { options: Record<string, unknown> }[] = [];
    const sender = createSessionMessageSender({
      spawnFns: {
        claude: async (_command, options) => {
          spawns.push({ options });
        },
      },
      bridge: { describeRegistrationForSession: () => null },
    });

    const session = sessionsDb.getSessionById('app-routed-2');
    assert.ok(session);

    const delivered = await sender({ session, text: 'Please address this comment' });

    assert.equal(delivered, true);
    assert.equal(spawns.length, 1);
    assert.equal('mcpServers' in spawns[0].options, false);
  });
});

test('the bridge is asked by the session id being resumed, not a stale one', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-routed-3', 'claude', '/workspace/demo');

    const askedFor: string[] = [];
    const sender = createSessionMessageSender({
      spawnFns: {
        claude: async () => {},
      },
      bridge: {
        describeRegistrationForSession: (sessionId) => {
          askedFor.push(sessionId);
          return REGISTRATION;
        },
      },
    });

    const session = sessionsDb.getSessionById('app-routed-3');
    assert.ok(session);

    await sender({ session, text: 'hello' });

    assert.deepEqual(askedFor, ['app-routed-3']);
  });
});

test('a bridge lookup that throws does not stop the comment from being routed', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-routed-4', 'claude', '/workspace/demo');

    const spawns: { options: Record<string, unknown> }[] = [];
    const sender = createSessionMessageSender({
      spawnFns: {
        claude: async (_command, options) => {
          spawns.push({ options });
        },
      },
      bridge: {
        describeRegistrationForSession: () => {
          throw new Error('bridge lookup exploded');
        },
      },
    });

    const session = sessionsDb.getSessionById('app-routed-4');
    assert.ok(session);

    const delivered = await sender({ session, text: 'hello' });

    assert.equal(delivered, true);
    assert.equal('mcpServers' in spawns[0].options, false);
  });
});
