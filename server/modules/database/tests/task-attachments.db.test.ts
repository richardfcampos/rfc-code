import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { taskAttachmentsDb } from '@/modules/database/repositories/task-attachments.db.js';
import { tasksDb } from '@/modules/database/repositories/tasks.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'task-attachments-db-'));
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

function createTask(): string {
  return tasksDb.create({ title: 'Ship it', projectName: 'my-app' }).id;
}

test('create stores an attachment linked to its task', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();

    const attachment = taskAttachmentsDb.create({
      taskId,
      fileName: 'design.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
      storedPath: '/home/dev/.cloudcli/task-attachments/design.png',
    });

    assert.ok(attachment.attachment_id);
    assert.equal(attachment.task_id, taskId);
    assert.equal(attachment.file_name, 'design.png');
    assert.equal(attachment.mime_type, 'image/png');
    assert.equal(attachment.size_bytes, 2048);
    assert.equal(attachment.stored_path, '/home/dev/.cloudcli/task-attachments/design.png');
  });
});

test('listByTask returns only attachments for the requested task, oldest first', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const otherTaskId = createTask();

    const first = taskAttachmentsDb.create({
      taskId,
      fileName: 'spec.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storedPath: '/tmp/spec.pdf',
    });
    const second = taskAttachmentsDb.create({
      taskId,
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 512,
      storedPath: '/tmp/notes.txt',
    });
    taskAttachmentsDb.create({
      taskId: otherTaskId,
      fileName: 'unrelated.txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
      storedPath: '/tmp/unrelated.txt',
    });

    const attachments = taskAttachmentsDb.listByTask(taskId);
    assert.equal(attachments.length, 2);
    assert.equal(attachments[0]!.attachment_id, first.attachment_id);
    assert.equal(attachments[1]!.attachment_id, second.attachment_id);
  });
});

test('deleting a task cascades to its attachments', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    taskAttachmentsDb.create({
      taskId,
      fileName: 'design.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
      storedPath: '/tmp/design.png',
    });

    tasksDb.delete(taskId);

    assert.equal(taskAttachmentsDb.listByTask(taskId).length, 0);
  });
});

test('delete removes the attachment and returns whether a row was affected', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const attachment = taskAttachmentsDb.create({
      taskId,
      fileName: 'design.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
      storedPath: '/tmp/design.png',
    });

    assert.equal(taskAttachmentsDb.delete(attachment.attachment_id), true);
    assert.equal(taskAttachmentsDb.get(attachment.attachment_id), null);
    assert.equal(taskAttachmentsDb.delete(attachment.attachment_id), false);
  });
});

test('an unknown task_id is rejected by the foreign key constraint', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO task_attachments (attachment_id, task_id, file_name, mime_type, size_bytes, stored_path)
             VALUES ('a1', 'missing-task', 'x.png', 'image/png', 10, '/tmp/x.png')`,
          )
          .run(),
      /FOREIGN KEY constraint failed/,
    );
  });
});
