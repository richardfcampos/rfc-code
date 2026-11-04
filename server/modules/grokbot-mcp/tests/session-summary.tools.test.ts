import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

import { projectTools } from '../tools/projects.tools.js';
import { sessionSummaryTools } from '../tools/session-summary.tools.js';

import { createFakeToolContext, runToolAndCapture } from './support/fake-tool-context.js';

test('session_summary declares its input and runs in-process (covers nothing)', () => {
  const [definition] = sessionSummaryTools;
  assert.ok(definition);
  assert.equal(definition.name, 'session_summary');
  assert.deepEqual(definition.covers, []);
  assert.deepEqual(definition.inputSchema.required, ['sessionId']);
  assert.ok('sinceSeq' in definition.inputSchema.properties);
});

test('session_summary rejects a missing sessionId and reports an unknown session as 404', async () => {
  const [definition] = sessionSummaryTools;
  assert.ok(definition);
  await assert.rejects(definition.run({}, createFakeToolContext()), /sessionId is required/);

  const previous = process.env.DATABASE_PATH;
  const dir = await mkdtemp(path.join(tmpdir(), 'session-summary-tool-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(dir, 'auth.db');
  await initializeDatabase();
  try {
    await assert.rejects(definition.run({ sessionId: 'ghost' }, createFakeToolContext()), (error: { statusCode?: number }) => error.statusCode === 404);
    sessionsDb.createAppSession('real', 'claude', path.join(dir, 'not-a-repo'));
    const summary = (await definition.run({ sessionId: 'real', sinceSeq: 0 }, createFakeToolContext())) as { sessionId: string; status: string };
    assert.equal(summary.sessionId, 'real');
    assert.equal(summary.status, 'idle');
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('project_list compact=true adds compact=1 to the query and nothing else changes', async () => {
  const compact = await runToolAndCapture(projectTools, 'project_list', { compact: true, skipSync: true });
  assert.equal(compact.request?.path, '/api/projects');
  assert.deepEqual(compact.request?.query, { compact: '1', skipSynchronization: '1' });

  const plain = await runToolAndCapture(projectTools, 'project_list', { sessionsLimit: 5 });
  assert.deepEqual(plain.request?.query, { sessionsLimit: 5 });
});
