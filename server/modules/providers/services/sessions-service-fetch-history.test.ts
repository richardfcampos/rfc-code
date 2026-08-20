import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  sessionLegsDb,
  sessionRunFailuresDb,
  sessionsDb,
} from '@/modules/database/index.js';
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

test('recorded run failures are appended to the newest history page', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    sessionsDb.assignProviderSessionId(created.sessionId, 'native-claude-1');
    sessionRunFailuresDb.recordFailure({
      sessionId: created.sessionId,
      provider: 'claude',
      errorMessage: "You've hit your session limit",
      exitCode: 1,
      failedAt: new Date('2026-01-01T11:00:00.000Z'),
    });

    const patched = patchProviderRegistry({
      claude: [buildMessage('m1', '2026-01-01T10:00:00.000Z', 'claude')],
    });

    try {
      const result = await sessionsService.fetchHistory(created.sessionId, { limit: null, offset: 0 });

      assert.equal(result.messages.length, 2);
      assert.equal(result.total, 2);
      const failureRow = result.messages.at(-1);
      assert.equal(failureRow?.kind, 'error');
      assert.equal(failureRow?.content, "You've hit your session limit");
      assert.equal(failureRow?.sessionId, created.sessionId);
    } finally {
      patched.restore();
    }
  });
});

test('a run that died before any transcript existed still explains itself', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    // No provider_session_id: the very first turn failed at login.
    sessionRunFailuresDb.recordFailure({
      sessionId: created.sessionId,
      provider: 'claude',
      errorMessage: 'Not logged in · Please run /login',
      exitCode: 1,
      failedAt: new Date('2026-01-01T11:00:00.000Z'),
    });

    const result = await sessionsService.fetchHistory(created.sessionId, { limit: null, offset: 0 });

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.kind, 'error');
    assert.equal(result.messages[0]?.content, 'Not logged in · Please run /login');
  });
});

test('older history pages stay pure transcript', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    sessionsDb.assignProviderSessionId(created.sessionId, 'native-claude-1');
    sessionRunFailuresDb.recordFailure({
      sessionId: created.sessionId,
      provider: 'claude',
      errorMessage: 'boom',
      exitCode: 1,
      failedAt: new Date('2026-01-01T11:00:00.000Z'),
    });

    const patched = patchProviderRegistry({
      claude: [buildMessage('m1', '2026-01-01T10:00:00.000Z', 'claude')],
    });

    try {
      const result = await sessionsService.fetchHistory(created.sessionId, { limit: 1, offset: 5 });

      assert.ok(result.messages.every((message) => message.kind !== 'error'));
    } finally {
      patched.restore();
    }
  });
});

// A session that failed once and then recovered keeps talking. The failure has
// to stay where it happened: appending it would park a resolved error below
// every later message, reading as the newest thing in the conversation.
test('a run failure sits in time order, not below later messages', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    sessionsDb.assignProviderSessionId(created.sessionId, 'native-claude-1');
    sessionRunFailuresDb.recordFailure({
      sessionId: created.sessionId,
      provider: 'claude',
      errorMessage: 'Not logged in · Please run /login',
      exitCode: 1,
      failedAt: new Date('2026-01-01T11:00:00.000Z'),
    });

    const patched = patchProviderRegistry({
      claude: [
        buildMessage('before', '2026-01-01T10:00:00.000Z', 'claude'),
        buildMessage('after', '2026-01-01T12:00:00.000Z', 'claude'),
        buildMessage('later', '2026-01-01T13:00:00.000Z', 'claude'),
      ],
    });

    try {
      const result = await sessionsService.fetchHistory(created.sessionId, { limit: null, offset: 0 });

      assert.deepEqual(
        result.messages.map((message) => message.id),
        ['before', 'run_failure_1', 'after', 'later'],
      );
      assert.equal(result.total, 4);
    } finally {
      patched.restore();
    }
  });
});

// Several failures across one conversation each keep their own slot, and the
// transcript itself is never reordered.
test('multiple run failures each land at their own point in the transcript', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    sessionsDb.assignProviderSessionId(created.sessionId, 'native-claude-1');
    sessionRunFailuresDb.recordFailure({
      sessionId: created.sessionId,
      provider: 'claude',
      errorMessage: 'first boom',
      exitCode: 1,
      failedAt: new Date('2026-01-01T10:30:00.000Z'),
    });
    sessionRunFailuresDb.recordFailure({
      sessionId: created.sessionId,
      provider: 'claude',
      errorMessage: 'second boom',
      exitCode: 1,
      failedAt: new Date('2026-01-01T12:30:00.000Z'),
    });

    const patched = patchProviderRegistry({
      claude: [
        buildMessage('m1', '2026-01-01T10:00:00.000Z', 'claude'),
        buildMessage('m2', '2026-01-01T12:00:00.000Z', 'claude'),
        buildMessage('m3', '2026-01-01T13:00:00.000Z', 'claude'),
      ],
    });

    try {
      const result = await sessionsService.fetchHistory(created.sessionId, { limit: null, offset: 0 });

      assert.deepEqual(
        result.messages.map((message) => message.id),
        ['m1', 'run_failure_1', 'm2', 'run_failure_2', 'm3'],
      );
    } finally {
      patched.restore();
    }
  });
});

// The tail is still the right place for a failure that really is the newest
// event, and for a transcript whose messages carry no comparable timestamp.
test('a failure newer than the whole page stays at the tail', async () => {
  await withIsolatedDatabase(async () => {
    const created = await sessionsService.createAppSession(
      'claude',
      '/workspace/demo',
      undefined,
      async (cwd) => ({ projectPath: cwd, worktreePath: null, worktreeBranch: null }),
    );
    sessionsDb.assignProviderSessionId(created.sessionId, 'native-claude-1');
    sessionRunFailuresDb.recordFailure({
      sessionId: created.sessionId,
      provider: 'claude',
      errorMessage: 'boom',
      exitCode: 1,
      failedAt: new Date('2026-01-01T14:00:00.000Z'),
    });

    const patched = patchProviderRegistry({
      claude: [
        buildMessage('m1', '2026-01-01T10:00:00.000Z', 'claude'),
        { ...buildMessage('m2', '', 'claude'), timestamp: 'not-a-date' },
      ],
    });

    try {
      const result = await sessionsService.fetchHistory(created.sessionId, { limit: null, offset: 0 });

      assert.deepEqual(
        result.messages.map((message) => message.id),
        ['m1', 'm2', 'run_failure_1'],
      );
    } finally {
      patched.restore();
    }
  });
});
