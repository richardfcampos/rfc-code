import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionLegsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { FetchHistoryResult, LLMProvider, NormalizedMessage } from '@/shared/types.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'fetch-history-service-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildMessage(id: string, timestamp: string, provider: LLMProvider): NormalizedMessage {
  return {
    id,
    sessionId: `provider-native-${provider}`,
    timestamp,
    provider,
    kind: 'text',
    role: 'assistant',
    content: id,
  };
}

/**
 * `providerRegistry` is a plain exported object (no DI seam), so tests patch
 * `resolveProvider` directly and restore it afterward — same pattern this
 * codebase already uses to patch `os.homedir` in opencode-sessions.test.ts.
 */
function patchProviderRegistry(
  messagesByProvider: Partial<Record<LLMProvider, NormalizedMessage[]>>,
): { restore: () => void; callsByProvider: Partial<Record<LLMProvider, number>> } {
  const original = providerRegistry.resolveProvider;
  const callsByProvider: Partial<Record<LLMProvider, number>> = {};

  providerRegistry.resolveProvider = ((provider: string) => {
    const key = provider as LLMProvider;
    callsByProvider[key] = (callsByProvider[key] ?? 0) + 1;
    const messages = messagesByProvider[key] ?? [];

    return {
      sessions: {
        fetchHistory: async (): Promise<FetchHistoryResult> => ({
          messages,
          total: messages.length,
          hasMore: false,
          offset: 0,
          limit: null,
        }),
      },
    } as unknown as IProvider;
  }) as typeof providerRegistry.resolveProvider;

  return {
    restore: () => {
      providerRegistry.resolveProvider = original;
    },
    callsByProvider,
  };
}

test('a session with no legs recorded uses the direct single-adapter path unchanged', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    sessionsDb.assignProviderSessionId(created.sessionId, 'native-claude-1');

    const patched = patchProviderRegistry({
      claude: [buildMessage('m1', '2026-01-01T10:00:00.000Z', 'claude')],
    });

    try {
      const result = await sessionsService.fetchHistory(created.sessionId, { limit: null, offset: 0 });

      assert.deepEqual(result.messages, [
        { ...buildMessage('m1', '2026-01-01T10:00:00.000Z', 'claude'), sessionId: created.sessionId },
      ]);
      assert.equal(result.total, 1);
      assert.equal(patched.callsByProvider.claude, 1);
    } finally {
      patched.restore();
    }
  });
});

test('a session with exactly one leg still uses the direct single-adapter path', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    sessionsDb.assignProviderSessionId(created.sessionId, 'native-claude-1');

    const leg = sessionLegsDb.openLeg({
      sessionId: created.sessionId,
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });
    sessionLegsDb.attachProviderSessionId(leg.leg_id, 'native-claude-1', null);

    const patched = patchProviderRegistry({
      claude: [buildMessage('m1', '2026-01-01T10:00:00.000Z', 'claude')],
    });

    try {
      const result = await sessionsService.fetchHistory(created.sessionId, { limit: null, offset: 0 });

      assert.deepEqual(result.messages, [
        { ...buildMessage('m1', '2026-01-01T10:00:00.000Z', 'claude'), sessionId: created.sessionId },
      ]);
      assert.equal(result.total, 1);
      assert.equal(patched.callsByProvider.claude, 1);
    } finally {
      patched.restore();
    }
  });
});

test('a session with two or more legs routes through fetchUnifiedHistory and gets the sessionId rewrite', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    sessionsDb.assignProviderSessionId(created.sessionId, 'native-claude-1');

    const legA = sessionLegsDb.openLeg({
      sessionId: created.sessionId,
      provider: 'claude',
      profileId: null,
      profileNameAtSwitch: null,
    });
    sessionLegsDb.attachProviderSessionId(legA.leg_id, 'native-claude-1', null);

    const legB = sessionLegsDb.openLeg({
      sessionId: created.sessionId,
      provider: 'codex',
      profileId: null,
      profileNameAtSwitch: 'Work Account',
    });
    sessionLegsDb.attachProviderSessionId(legB.leg_id, 'native-codex-1', null);

    // Leg `started_at` is stamped by SQLite `CURRENT_TIMESTAMP` (real wall-clock
    // time), so message timestamps must be built relative to it rather than to
    // a fixed date, or the merge would sort them at the wrong end of history.
    const legBStartMs = new Date(legB.started_at.replace(' ', 'T') + 'Z').getTime();
    const patched = patchProviderRegistry({
      claude: [buildMessage('a1', new Date(legBStartMs - 60_000).toISOString(), 'claude')],
      codex: [buildMessage('b1', new Date(legBStartMs + 60_000).toISOString(), 'codex')],
    });

    try {
      const result = await sessionsService.fetchHistory(created.sessionId, { limit: null, offset: 0 });

      assert.deepEqual(
        result.messages.map((message) => message.id),
        ['a1', `leg-marker-${legB.leg_id}`, 'b1'],
      );
      assert.ok(result.messages.every((message) => message.sessionId === created.sessionId));
      assert.equal(result.total, 3);
      assert.equal(patched.callsByProvider.claude, 1);
      assert.equal(patched.callsByProvider.codex, 1);
    } finally {
      patched.restore();
    }
  });
});
