import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  createTasksService,
  TaskAttachmentNotFoundError,
  TaskEvidenceNotFoundError,
  TaskNotFoundError,
  TaskValidationError,
  type AssertAssigneeAllowed,
} from '@/modules/tasks/tasks.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'tasks-service-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
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

function insertProfile(id: string, name: string): void {
  getConnection()
    .prepare('INSERT INTO profiles (id, provider, name, slug) VALUES (?, ?, ?, ?)')
    .run(id, 'claude', name, id);
}

function createService(assertAssigneeAllowed: AssertAssigneeAllowed = () => {}) {
  return createTasksService({ assertAssigneeAllowed });
}

test('createTask rejects an empty title', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(
      () => service.createTask({ title: '   ', project: 'my-app' }),
      TaskValidationError,
    );
  });
});

test('createTask rejects a title over 500 characters', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(
      () => service.createTask({ title: 'a'.repeat(501), project: 'my-app' }),
      TaskValidationError,
    );
  });
});

test('createTask accepts a title at exactly 500 characters', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'a'.repeat(500), project: 'my-app' });
    assert.equal(task.title.length, 500);
  });
});

test('createTask rejects a missing project', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(
      () => service.createTask({ title: 'Ship it' }),
      TaskValidationError,
    );
  });
});

test('createTask rejects an invalid origin', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(
      () => service.createTask({ title: 'Ship it', project: 'my-app', origin: 'robot' }),
      TaskValidationError,
    );
  });
});

test('createTask defaults stage to backlog and origin to user', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    assert.equal(task.stage, 'backlog');
    assert.equal(task.origin, 'user');
    assert.equal(task.description, null);
  });
});

test('createTask calls the assignee hook when an assignee is set', async () => {
  await withIsolatedDatabase(async () => {
    insertProfile('profile-a', 'Alice');
    const calls: Array<[string, string]> = [];
    const service = createService((project, profileId) => {
      calls.push([project, profileId]);
    });

    const task = await service.createTask({
      title: 'Ship it',
      project: 'my-app',
      assignee_profile_id: 'profile-a',
    });

    assert.equal(task.assignee_profile_id, 'profile-a');
    assert.deepEqual(calls, [['my-app', 'profile-a']]);
  });
});

test('createTask does not call the assignee hook when no assignee is set', async () => {
  await withIsolatedDatabase(async () => {
    let called = false;
    const service = createService(() => {
      called = true;
    });

    await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.equal(called, false);
  });
});

test('createTask propagates a rejection from the assignee hook', async () => {
  await withIsolatedDatabase(async () => {
    insertProfile('profile-a', 'Alice');
    const service = createService(() => {
      throw new Error('assignee not allowed');
    });

    await assert.rejects(
      () => service.createTask({
        title: 'Ship it',
        project: 'my-app',
        assignee_profile_id: 'profile-a',
      }),
      /assignee not allowed/,
    );
  });
});

test('listTasks rejects a missing project', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    assert.throws(() => service.listTasks(undefined), TaskValidationError);
  });
});

test('listTasks returns only tasks for the requested project', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await service.createTask({ title: 'Task A', project: 'my-app' });
    await service.createTask({ title: 'Task B', project: 'other-app' });

    const tasks = service.listTasks('my-app');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.title, 'Task A');
  });
});

test('updateTask rejects an unknown task id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    await assert.rejects(() => service.updateTask('missing-id', { stage: 'done' }), TaskNotFoundError);
  });
});

test('updateTask rejects an invalid stage', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    await assert.rejects(() => service.updateTask(task.id, { stage: 'shipped' }), TaskValidationError);
  });
});

test('updateTask rejects an empty title', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    await assert.rejects(() => service.updateTask(task.id, { title: '  ' }), TaskValidationError);
  });
});

test('updateTask applies a partial update and calls the assignee hook only for the changed field', async () => {
  await withIsolatedDatabase(async () => {
    insertProfile('profile-a', 'Alice');
    const calls: Array<[string, string]> = [];
    const service = createService((project, profileId) => {
      calls.push([project, profileId]);
    });

    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    const updated = await service.updateTask(task.id, {
      stage: 'in_progress',
      assignee_profile_id: 'profile-a',
    });

    assert.equal(updated.stage, 'in_progress');
    assert.equal(updated.assignee_profile_id, 'profile-a');
    assert.deepEqual(calls, [['my-app', 'profile-a']]);
  });
});

test('updateTask clears the assignee when assignee_profile_id is set to null and skips the hook', async () => {
  await withIsolatedDatabase(async () => {
    insertProfile('profile-a', 'Alice');
    let called = false;
    const service = createService(() => {
      called = true;
    });

    const task = await service.createTask({
      title: 'Ship it',
      project: 'my-app',
      assignee_profile_id: 'profile-a',
    });
    called = false;

    const updated = await service.updateTask(task.id, { assignee_profile_id: null });

    assert.equal(updated.assignee_profile_id, null);
    assert.equal(called, false);
  });
});

test('deleteTask rejects an unknown task id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    assert.throws(() => service.deleteTask('missing-id'), TaskNotFoundError);
  });
});

test('deleteTask removes the task and returns the deleted row', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    const deleted = service.deleteTask(task.id);

    assert.equal(deleted.id, task.id);
    assert.equal(service.listTasks('my-app').length, 0);
  });
});

test('updateTask sets and clears the description', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    const withDescription = await service.updateTask(task.id, { description: 'Repro then fix' });
    assert.equal(withDescription.description, 'Repro then fix');

    const cleared = await service.updateTask(task.id, { description: null });
    assert.equal(cleared.description, null);
  });
});

test('getTaskDetail rejects an unknown task id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    assert.throws(() => service.getTaskDetail('missing-id'), TaskNotFoundError);
  });
});

test('getTaskDetail returns the task with its attachments and evidence', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    const attachment = service.addAttachment(task.id, {
      fileName: 'design.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      storedPath: '/tmp/design.png',
    });
    service.addEvidence(task.id, { kind: 'note', content: 'Repro confirmed' });

    const detail = service.getTaskDetail(task.id);
    assert.equal(detail.task.id, task.id);
    assert.equal(detail.attachments.length, 1);
    assert.equal(detail.attachments[0]!.attachment_id, attachment.attachment_id);
    assert.equal(detail.evidence.length, 1);
    assert.equal(detail.evidence[0]!.content, 'Repro confirmed');
  });
});

test('addAttachment rejects an unknown task id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    assert.throws(
      () =>
        service.addAttachment('missing-id', {
          fileName: 'x.png',
          mimeType: 'image/png',
          sizeBytes: 10,
          storedPath: '/tmp/x.png',
        }),
      TaskNotFoundError,
    );
  });
});

test('addAttachment rejects an empty file name', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.throws(
      () =>
        service.addAttachment(task.id, {
          fileName: '   ',
          mimeType: 'image/png',
          sizeBytes: 10,
          storedPath: '/tmp/x.png',
        }),
      TaskValidationError,
    );
  });
});

test('addAttachment rejects a size over the configured cap', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.throws(
      () =>
        service.addAttachment(task.id, {
          fileName: 'huge.bin',
          mimeType: 'application/octet-stream',
          sizeBytes: 21 * 1024 * 1024,
          storedPath: '/tmp/huge.bin',
        }),
      TaskValidationError,
    );
  });
});

test('getAttachment rejects an attachment that belongs to a different task', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const taskA = await service.createTask({ title: 'Task A', project: 'my-app' });
    const taskB = await service.createTask({ title: 'Task B', project: 'my-app' });

    const attachment = service.addAttachment(taskA.id, {
      fileName: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      storedPath: '/tmp/a.png',
    });

    assert.throws(() => service.getAttachment(taskB.id, attachment.attachment_id), TaskAttachmentNotFoundError);
  });
});

test('deleteAttachment removes the row and returns it', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    const attachment = service.addAttachment(task.id, {
      fileName: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      storedPath: '/tmp/a.png',
    });

    const deleted = service.deleteAttachment(task.id, attachment.attachment_id);
    assert.equal(deleted.attachment_id, attachment.attachment_id);
    assert.equal(service.getTaskDetail(task.id).attachments.length, 0);
  });
});

test('deleteAttachment rejects an unknown attachment id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.throws(() => service.deleteAttachment(task.id, 'missing-attachment'), TaskAttachmentNotFoundError);
  });
});

test('addEvidence stores a note without an attachment reference', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    const evidence = service.addEvidence(task.id, { kind: 'note', content: 'Repro confirmed on staging' });
    assert.equal(evidence.kind, 'note');
    assert.equal(evidence.attachment_id, null);
  });
});

test('addEvidence rejects an invalid kind', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.throws(() => service.addEvidence(task.id, { kind: 'video', content: 'x' }), TaskValidationError);
  });
});

test('addEvidence rejects empty content', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.throws(() => service.addEvidence(task.id, { kind: 'note', content: '   ' }), TaskValidationError);
  });
});

test('addEvidence of kind "attachment" requires an attachment_id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.throws(
      () => service.addEvidence(task.id, { kind: 'attachment', content: 'see file' }),
      TaskValidationError,
    );
  });
});

test('addEvidence of kind "attachment" requires an attachment_id that exists on the same task', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.throws(
      () => service.addEvidence(task.id, { kind: 'attachment', content: 'see file', attachment_id: 'missing-id' }),
      TaskAttachmentNotFoundError,
    );

    const attachment = service.addAttachment(task.id, {
      fileName: 'log.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      storedPath: '/tmp/log.txt',
    });
    const evidence = service.addEvidence(task.id, {
      kind: 'attachment',
      content: 'see attached log',
      attachment_id: attachment.attachment_id,
    });
    assert.equal(evidence.attachment_id, attachment.attachment_id);
  });
});

test('addEvidence rejects attachment_id on a note or link entry', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    const attachment = service.addAttachment(task.id, {
      fileName: 'log.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      storedPath: '/tmp/log.txt',
    });

    assert.throws(
      () =>
        service.addEvidence(task.id, {
          kind: 'note',
          content: 'x',
          attachment_id: attachment.attachment_id,
        }),
      TaskValidationError,
    );
  });
});

test('deleteEvidence removes the row and returns it', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });
    const evidence = service.addEvidence(task.id, { kind: 'link', content: 'https://example.com/run/1' });

    const deleted = service.deleteEvidence(task.id, evidence.evidence_id);
    assert.equal(deleted.evidence_id, evidence.evidence_id);
    assert.equal(service.getTaskDetail(task.id).evidence.length, 0);
  });
});

test('deleteEvidence rejects an unknown evidence id', async () => {
  await withIsolatedDatabase(async () => {
    const service = createService();
    const task = await service.createTask({ title: 'Ship it', project: 'my-app' });

    assert.throws(() => service.deleteEvidence(task.id, 'missing-evidence'), TaskEvidenceNotFoundError);
  });
});
