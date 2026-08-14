import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { configureBtwRuntime, executeBtwCommand } from '@/modules/commands/index.js';
import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

/** Boots an isolated database in a temp dir for one test. */
async function withDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'btw-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('an empty question is answered with usage instead of a run', async () => {
  const result = await executeBtwCommand([], { sessionId: 'session-1' });

  assert.equal(result.action, 'btw');
  assert.equal(result.data.status, 'error');
  assert.match(result.data.status === 'error' ? result.data.message : '', /\/btw/);
});

test('a question without a session says so', async () => {
  await withDatabase(async () => {
    const result = await executeBtwCommand(['does', 'this', 'work'], { sessionId: null });

    assert.equal(result.data.status, 'error');
    assert.equal(result.data.question, 'does this work');
    assert.match(
      result.data.status === 'error' ? result.data.message : '',
      /start a conversation first/,
    );
  });
});

test('an unknown session id is reported, not thrown', async () => {
  await withDatabase(async () => {
    const result = await executeBtwCommand(['hello'], { sessionId: 'missing-session' });

    assert.equal(result.data.status, 'error');
    assert.match(
      result.data.status === 'error' ? result.data.message : '',
      /start a conversation first/,
    );
  });
});

test('a Claude session answers the question and leaves the session untouched', async () => {
  await withDatabase(async () => {
    const projectPath = path.join(tmpdir(), 'btw-project');
    sessionsDb.createAppSession('claude-session', 'claude', projectPath, 'profile-1');
    const before = sessionsDb.getSessionById('claude-session');

    const calls: Array<{ command: string; options: Record<string, unknown> }> = [];
    configureBtwRuntime(async (command, options) => {
      calls.push({ command, options });
      return 'It uses better-auth.';
    });

    const result = await executeBtwCommand(['what', 'about', 'auth'], {
      sessionId: 'claude-session',
      model: 'claude-sonnet-4-5',
    });

    assert.deepEqual(result.data, {
      status: 'done',
      question: 'what about auth',
      answer: 'It uses better-auth.',
    });
    assert.equal(calls.length, 1);
    // No transcript on disk yet, so the run gets the bare question.
    assert.equal(calls[0].command, 'what about auth');
    assert.equal(calls[0].options.model, 'claude-sonnet-4-5');
    assert.equal(calls[0].options.profileId, 'profile-1');
    assert.deepEqual(sessionsDb.getSessionById('claude-session'), before);
  });
});

test('a failing run is reported as an error payload instead of throwing', async () => {
  await withDatabase(async () => {
    sessionsDb.createAppSession('claude-session', 'claude', path.join(tmpdir(), 'btw-project'));
    configureBtwRuntime(async () => {
      throw new Error('Claude did not answer within 60s.');
    });

    const result = await executeBtwCommand(['still', 'there'], { sessionId: 'claude-session' });

    assert.equal(result.data.status, 'error');
    assert.equal(
      result.data.status === 'error' ? result.data.message : '',
      'Claude did not answer within 60s.',
    );
  });
});

test('a non-Claude session is refused without touching the session row', async () => {
  await withDatabase(async () => {
    sessionsDb.createAppSession('codex-session', 'codex', path.join(tmpdir(), 'btw-project'));
    const before = sessionsDb.getSessionById('codex-session');

    const result = await executeBtwCommand(['why', 'is', 'it', 'slow'], {
      sessionId: 'codex-session',
    });

    assert.equal(result.type, 'builtin');
    assert.equal(result.data.status, 'error');
    assert.equal(result.data.question, 'why is it slow');
    assert.match(
      result.data.status === 'error' ? result.data.message : '',
      /only supported for Claude sessions/,
    );
    assert.deepEqual(sessionsDb.getSessionById('codex-session'), before);
  });
});
