import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentMessageRow } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

import { MAESTRO, OUTSIDER, WORKER, withMessagesService } from './support/with-messages-service.js';

function expectAppError(run: () => unknown, expected: { code: string; statusCode: number }): AppError {
  let thrown: unknown = null;
  try {
    run();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof AppError, `expected an AppError, got ${String(thrown)}`);
  assert.equal(thrown.code, expected.code);
  assert.equal(thrown.statusCode, expected.statusCode);
  return thrown;
}

test('send queues a message addressed to another live session and broadcasts it', async () => {
  await withMessagesService(({ service, broadcasts }) => {
    const message = service.send(MAESTRO, {
      toSessionId: WORKER,
      subject: '  Review the parser fix  ',
      body: '  Branch feat/parser is ready.  ',
    });

    assert.equal(message.from_session_id, MAESTRO);
    assert.equal(message.to_session_id, WORKER);
    assert.equal(message.subject, 'Review the parser fix');
    assert.equal(message.body, 'Branch feat/parser is ready.');
    assert.equal(message.state, 'queued');
    assert.deepEqual(broadcasts.map(([, action]) => action), ['created']);
  });
});

test('send refuses a missing subject or body before writing anything', async () => {
  await withMessagesService(({ service, broadcasts }) => {
    expectAppError(() => service.send(MAESTRO, { toSessionId: WORKER, body: 'no subject' }), {
      code: 'AGENT_MESSAGE_VALIDATION_ERROR',
      statusCode: 400,
    });
    expectAppError(() => service.send(MAESTRO, { toSessionId: WORKER, subject: 'no body', body: '   ' }), {
      code: 'AGENT_MESSAGE_VALIDATION_ERROR',
      statusCode: 400,
    });
    assert.equal(broadcasts.length, 0);
    assert.equal(service.list(WORKER, { box: 'inbox' }).length, 0);
  });
});

test('send refuses an oversized body instead of truncating it', async () => {
  await withMessagesService(({ service }) => {
    expectAppError(
      () => service.send(MAESTRO, { toSessionId: WORKER, subject: 'big', body: 'x'.repeat(20_001) }),
      { code: 'AGENT_MESSAGE_VALIDATION_ERROR', statusCode: 400 },
    );
  });
});

test('send refuses a recipient that is not a live session', async () => {
  await withMessagesService(({ service }) => {
    expectAppError(
      () => service.send(MAESTRO, { toSessionId: 'session-gone', subject: 'hi', body: 'there' }),
      { code: 'AGENT_MESSAGE_RECIPIENT_UNKNOWN', statusCode: 404 },
    );
  });
});

test('send refuses a message a session addresses to itself', async () => {
  await withMessagesService(({ service }) => {
    expectAppError(() => service.send(MAESTRO, { toSessionId: MAESTRO, subject: 'hi', body: 'me' }), {
      code: 'AGENT_MESSAGE_VALIDATION_ERROR',
      statusCode: 400,
    });
  });
});

test('send refuses to thread onto a message the sender is not part of', async () => {
  await withMessagesService(({ service, handoff }) => {
    const message = handoff();

    expectAppError(
      () =>
        service.send(OUTSIDER, {
          toSessionId: WORKER,
          subject: 'butting in',
          body: 'not my thread',
          replyToMessageId: message.message_id,
        }),
      { code: 'AGENT_MESSAGE_NOT_FOUND', statusCode: 404 },
    );
  });
});

test('list separates inbox from outbox and never changes a state', async () => {
  await withMessagesService(({ service, broadcasts, handoff }) => {
    const message = handoff();
    broadcasts.length = 0;

    assert.deepEqual(
      service.list(WORKER, { box: 'inbox' }).map((row) => row.message_id),
      [message.message_id],
    );
    assert.deepEqual(
      service.list(MAESTRO, { box: 'outbox' }).map((row) => row.message_id),
      [message.message_id],
    );
    assert.deepEqual(service.list(MAESTRO, { box: 'inbox' }), []);

    // The read-only surface must not forge a delivery.
    assert.equal(service.list(WORKER, { box: 'inbox' })[0]!.state, 'queued');
    assert.equal(broadcasts.length, 0);
  });
});

test('list defaults to the inbox and rejects an unknown box or state', async () => {
  await withMessagesService(({ service, handoff }) => {
    handoff();

    assert.equal(service.list(WORKER, {}).length, 1);
    expectAppError(() => service.list(WORKER, { box: 'archive' }), {
      code: 'AGENT_MESSAGE_VALIDATION_ERROR',
      statusCode: 400,
    });
    expectAppError(() => service.list(WORKER, { state: 'read' }), {
      code: 'AGENT_MESSAGE_VALIDATION_ERROR',
      statusCode: 400,
    });
  });
});

test('pullInbox is what marks a queued message delivered', async () => {
  await withMessagesService(({ service, broadcasts, handoff }) => {
    handoff();
    broadcasts.length = 0;

    const pulled = service.pullInbox(WORKER, {});

    assert.deepEqual(pulled.map((row) => row.state), ['delivered']);
    assert.deepEqual(broadcasts.map(([, action]) => action), ['updated']);
    assert.equal(service.list(WORKER, { box: 'inbox' })[0]!.state, 'delivered');
  });
});

test('pulling twice delivers once and leaves the state alone the second time', async () => {
  await withMessagesService(({ service, broadcasts, handoff }) => {
    handoff();
    service.pullInbox(WORKER, {});
    broadcasts.length = 0;

    const second = service.pullInbox(WORKER, {});

    assert.deepEqual(second.map((row) => row.state), ['delivered']);
    assert.equal(broadcasts.length, 0);
  });
});

test('pullInbox never touches messages addressed to another session', async () => {
  await withMessagesService(({ service, handoff }) => {
    handoff();

    assert.deepEqual(service.pullInbox(OUTSIDER, {}), []);
    assert.equal(service.list(WORKER, { box: 'inbox' })[0]!.state, 'queued');
  });
});

test('acknowledge moves a delivered message and refuses one that was never pulled', async () => {
  await withMessagesService(({ service, handoff }) => {
    const message = handoff();

    const invalid = expectAppError(() => service.acknowledge(WORKER, message.message_id), {
      code: 'AGENT_MESSAGE_INVALID_TRANSITION',
      statusCode: 409,
    });
    assert.deepEqual(invalid.details, {
      messageId: message.message_id,
      from: 'queued',
      to: 'acknowledged',
    });

    service.pullInbox(WORKER, {});
    assert.equal(service.acknowledge(WORKER, message.message_id).state, 'acknowledged');
  });
});

test('only the recipient may acknowledge, and the sender is told nothing exists', async () => {
  await withMessagesService(({ service, handoff }) => {
    const message = handoff();
    service.pullInbox(WORKER, {});

    expectAppError(() => service.acknowledge(MAESTRO, message.message_id), {
      code: 'AGENT_MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
    expectAppError(() => service.acknowledge(OUTSIDER, message.message_id), {
      code: 'AGENT_MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
  });
});

test('acknowledge on an unknown message id is a 404', async () => {
  await withMessagesService(({ service }) => {
    expectAppError(() => service.acknowledge(WORKER, 'nope'), {
      code: 'AGENT_MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
  });
});

test('answer settles the original and queues a linked reply back to the sender', async () => {
  await withMessagesService(({ service, broadcasts, handoff }) => {
    const original = handoff();
    service.pullInbox(WORKER, {});
    service.acknowledge(WORKER, original.message_id);
    broadcasts.length = 0;

    const { message, reply } = service.answer(WORKER, original.message_id, {
      body: 'Merged, tests green.',
    });

    assert.equal(message.state, 'answered');
    assert.equal(reply.state, 'queued');
    assert.equal(reply.from_session_id, WORKER);
    assert.equal(reply.to_session_id, MAESTRO);
    assert.equal(reply.subject, 'Re: Review the parser fix');
    assert.equal(reply.reply_to_message_id, original.message_id);
    assert.deepEqual(broadcasts.map(([, action]) => action), ['updated', 'created']);

    // The reply lands in the original sender's inbox, closing the loop.
    assert.deepEqual(
      service.list(MAESTRO, { box: 'inbox' }).map((row) => row.message_id),
      [reply.message_id],
    );
  });
});

test('answer accepts an explicit subject and works straight from delivered', async () => {
  await withMessagesService(({ service, handoff }) => {
    const original = handoff();
    service.pullInbox(WORKER, {});

    const { message, reply } = service.answer(WORKER, original.message_id, {
      body: 'Done.',
      subject: 'Parser fix landed',
    });

    assert.equal(message.state, 'answered');
    assert.equal(reply.subject, 'Parser fix landed');
  });
});

test('answering twice is refused and creates no second reply', async () => {
  await withMessagesService(({ service, handoff }) => {
    const original = handoff();
    service.pullInbox(WORKER, {});
    service.answer(WORKER, original.message_id, { body: 'first' });

    expectAppError(() => service.answer(WORKER, original.message_id, { body: 'second' }), {
      code: 'AGENT_MESSAGE_INVALID_TRANSITION',
      statusCode: 409,
    });
    assert.equal(service.list(WORKER, { box: 'outbox' }).length, 1);
  });
});

test('an answer with an invalid body leaves the original untouched', async () => {
  await withMessagesService(({ service, handoff }) => {
    const original = handoff();
    service.pullInbox(WORKER, {});

    expectAppError(() => service.answer(WORKER, original.message_id, { body: '  ' }), {
      code: 'AGENT_MESSAGE_VALIDATION_ERROR',
      statusCode: 400,
    });
    assert.equal(service.list(WORKER, { box: 'inbox' })[0]!.state, 'delivered');
    assert.equal(service.list(WORKER, { box: 'outbox' }).length, 0);
  });
});

test('fail records the reason and can be called by either participant', async () => {
  await withMessagesService(({ service, broadcasts, handoff }) => {
    const abandoned = handoff();
    broadcasts.length = 0;

    const failed = service.fail(MAESTRO, abandoned.message_id, '  worker never picked it up  ');
    assert.equal(failed.state, 'failed');
    assert.equal(failed.detail, 'worker never picked it up');
    assert.deepEqual(broadcasts.map(([, action]) => action), ['updated']);

    const refused = handoff({ subject: 'Second try' });
    service.pullInbox(WORKER, {});
    assert.equal(service.fail(WORKER, refused.message_id, 'out of scope').state, 'failed');
  });
});

test('fail on a settled message is a conflict, not a silent overwrite', async () => {
  await withMessagesService(({ service, handoff }) => {
    const message = handoff();
    service.pullInbox(WORKER, {});
    service.answer(WORKER, message.message_id, { body: 'done' });

    expectAppError(() => service.fail(MAESTRO, message.message_id, 'changed my mind'), {
      code: 'AGENT_MESSAGE_INVALID_TRANSITION',
      statusCode: 409,
    });
  });
});

test('fail without a reason stores no detail', async () => {
  await withMessagesService(({ service, handoff }) => {
    const message = handoff();

    assert.equal(service.fail(MAESTRO, message.message_id).detail, null);
  });
});

test('an outsider cannot fail a handoff between two other sessions', async () => {
  await withMessagesService(({ service, handoff }) => {
    const message = handoff();

    expectAppError(() => service.fail(OUTSIDER, message.message_id, 'not mine'), {
      code: 'AGENT_MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
    assert.equal(service.list(WORKER, { box: 'inbox' })[0]!.state, 'queued');
  });
});

test('a state filter narrows a mailbox to one lifecycle stage', async () => {
  await withMessagesService(({ service, handoff }) => {
    const delivered = handoff({ subject: 'first' });
    service.pullInbox(WORKER, {});
    const stillQueued = handoff({ subject: 'second' });

    const queued: AgentMessageRow[] = service.list(WORKER, { box: 'inbox', state: 'queued' });
    assert.deepEqual(queued.map((row) => row.message_id), [stillQueued.message_id]);
    assert.deepEqual(
      service.list(WORKER, { box: 'inbox', state: 'delivered' }).map((row) => row.message_id),
      [delivered.message_id],
    );
  });
});
