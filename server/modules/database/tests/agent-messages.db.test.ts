import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { agentMessagesDb } from '@/modules/database/repositories/agent-messages.db.js';
import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';

const MAESTRO = 'session-maestro';
const WORKER = 'session-worker';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'agent-messages-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function send(overrides: Partial<Parameters<typeof agentMessagesDb.create>[0]> = {}) {
  return agentMessagesDb.create({
    fromSessionId: MAESTRO,
    toSessionId: WORKER,
    subject: 'Review the parser fix',
    body: 'Branch feat/parser is ready.',
    ...overrides,
  });
}

test('create stores a queued message with no reply link', async () => {
  await withIsolatedDatabase(() => {
    const message = send();

    assert.ok(message.message_id);
    assert.equal(message.from_session_id, MAESTRO);
    assert.equal(message.to_session_id, WORKER);
    assert.equal(message.state, 'queued');
    assert.equal(message.reply_to_message_id, null);
    assert.equal(message.detail, null);
  });
});

test('an unknown state is rejected by the CHECK constraint', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO agent_messages (message_id, from_session_id, to_session_id, subject, body, state)
             VALUES ('m1', ?, ?, 's', 'b', 'read')`,
          )
          .run(MAESTRO, WORKER),
      /CHECK constraint failed/,
    );
  });
});

test('listForSession separates inbox from outbox and filters by state', async () => {
  await withIsolatedDatabase(() => {
    const incoming = send();
    const outgoing = send({ fromSessionId: WORKER, toSessionId: MAESTRO, subject: 'Need context' });

    assert.deepEqual(
      agentMessagesDb.listForSession(WORKER, { box: 'inbox' }).map((row) => row.message_id),
      [incoming.message_id],
    );
    assert.deepEqual(
      agentMessagesDb.listForSession(WORKER, { box: 'outbox' }).map((row) => row.message_id),
      [outgoing.message_id],
    );

    agentMessagesDb.transition(incoming.message_id, 'delivered', ['queued']);
    assert.deepEqual(agentMessagesDb.listForSession(WORKER, { box: 'inbox', state: 'queued' }), []);
    assert.equal(agentMessagesDb.listForSession(WORKER, { box: 'inbox', state: 'delivered' }).length, 1);
  });
});

test('listForSession returns a mailbox oldest first so it reads as a queue', async () => {
  await withIsolatedDatabase(() => {
    const first = send({ subject: 'first' });
    const second = send({ subject: 'second' });

    assert.deepEqual(
      agentMessagesDb.listForSession(WORKER, { box: 'inbox' }).map((row) => row.subject),
      [first.subject, second.subject],
    );
  });
});

test('transition only moves a message out of one of the allowed states', async () => {
  await withIsolatedDatabase(() => {
    const message = send();

    assert.equal(agentMessagesDb.transition(message.message_id, 'acknowledged', ['delivered']), null);
    assert.equal(agentMessagesDb.get(message.message_id)!.state, 'queued');

    const delivered = agentMessagesDb.transition(message.message_id, 'delivered', ['queued']);
    assert.equal(delivered!.state, 'delivered');
  });
});

test('two racing transitions out of the same state produce exactly one winner', async () => {
  await withIsolatedDatabase(() => {
    const message = send();

    const first = agentMessagesDb.transition(message.message_id, 'delivered', ['queued']);
    const second = agentMessagesDb.transition(message.message_id, 'delivered', ['queued']);

    assert.ok(first);
    assert.equal(second, null);
  });
});

test('a failed transition records its reason in detail', async () => {
  await withIsolatedDatabase(() => {
    const message = send();

    const failed = agentMessagesDb.transition(message.message_id, 'failed', ['queued'], 'recipient session gone');

    assert.equal(failed!.state, 'failed');
    assert.equal(failed!.detail, 'recipient session gone');
  });
});

test('transition on an unknown message id reports no winner instead of throwing', async () => {
  await withIsolatedDatabase(() => {
    assert.equal(agentMessagesDb.transition('does-not-exist', 'delivered', ['queued']), null);
  });
});

test('listReplies returns the answers linked to a message', async () => {
  await withIsolatedDatabase(() => {
    const question = send();
    const reply = send({
      fromSessionId: WORKER,
      toSessionId: MAESTRO,
      subject: 'Re: Review the parser fix',
      replyToMessageId: question.message_id,
    });
    send({ subject: 'unrelated' });

    assert.deepEqual(
      agentMessagesDb.listReplies(question.message_id).map((row) => row.message_id),
      [reply.message_id],
    );
  });
});

test('messages survive a reopen of the database', async () => {
  await withIsolatedDatabase(async () => {
    const message = send();
    agentMessagesDb.transition(message.message_id, 'delivered', ['queued']);

    // Reopening the same file is what a server restart looks like to this
    // module: nothing about the inbox lives in memory.
    closeConnection();
    await initializeDatabase();

    const reloaded = agentMessagesDb.get(message.message_id);
    assert.equal(reloaded!.state, 'delivered');
    assert.equal(reloaded!.subject, message.subject);
  });
});

test('deleteBySession removes messages on both sides of that session', async () => {
  await withIsolatedDatabase(() => {
    send();
    send({ fromSessionId: WORKER, toSessionId: MAESTRO });
    send({ fromSessionId: 'session-other', toSessionId: 'session-third' });

    assert.equal(agentMessagesDb.deleteBySession(WORKER), 2);
    assert.equal(agentMessagesDb.listForSession(WORKER, { box: 'inbox' }).length, 0);
    assert.equal(agentMessagesDb.listForSession('session-third', { box: 'inbox' }).length, 1);
  });
});
