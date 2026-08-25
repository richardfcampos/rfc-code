/**
 * Service harness: a real (temporary) database, fake session liveness and a
 * recorded broadcast.
 *
 * The repository is exercised for real because the state machine's guarantees
 * are enforced by SQL (`UPDATE ... WHERE state IN (...)`); faking storage here
 * would test a different machine than the one that ships.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createAgentMessagesService,
  type AgentMessagesService,
} from '@/modules/agent-messages/agent-messages.service.js';
import type { AgentMessageUpdateAction } from '@/modules/agent-messages/agent-message-broadcast.js';
import {
  closeConnection,
  initializeDatabase,
  type AgentMessageRow,
} from '@/modules/database/index.js';

export const MAESTRO = 'session-maestro';
export const WORKER = 'session-worker';
export const OUTSIDER = 'session-outsider';

/** Every session the tests address exists, except the one named "gone". */
const KNOWN_SESSIONS = new Set([MAESTRO, WORKER, OUTSIDER]);

export type ServiceHarness = {
  service: AgentMessagesService;
  broadcasts: Array<[AgentMessageRow, AgentMessageUpdateAction]>;
  /** Sends one message from the maestro to the worker and returns it. */
  handoff(overrides?: Record<string, unknown>): AgentMessageRow;
};

export async function withMessagesService(
  runTest: (harness: ServiceHarness) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'agent-messages-service-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const broadcasts: Array<[AgentMessageRow, AgentMessageUpdateAction]> = [];
  const service = createAgentMessagesService({
    sessionExists: (sessionId) => KNOWN_SESSIONS.has(sessionId),
    broadcast: (message, action) => {
      broadcasts.push([message, action]);
    },
  });

  try {
    await runTest({
      service,
      broadcasts,
      handoff: (overrides = {}) =>
        service.send(MAESTRO, {
          toSessionId: WORKER,
          subject: 'Review the parser fix',
          body: 'Branch feat/parser is ready.',
          ...overrides,
        }),
    });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
