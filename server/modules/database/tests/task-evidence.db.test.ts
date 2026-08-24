import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { taskAttachmentsDb } from '@/modules/database/repositories/task-attachments.db.js';
import { taskEvidenceDb } from '@/modules/database/repositories/task-evidence.db.js';
import { tasksDb } from '@/modules/database/repositories/tasks.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'task-evidence-db-'));
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

test('create stores a note entry with no attachment', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();

    const evidence = taskEvidenceDb.create({ taskId, kind: 'note', content: 'Repro confirmed on staging' });

    assert.ok(evidence.evidence_id);
    assert.equal(evidence.task_id, taskId);
    assert.equal(evidence.kind, 'note');
    assert.equal(evidence.content, 'Repro confirmed on staging');
    assert.equal(evidence.attachment_id, null);
  });
});

test('create stores an attachment entry linked to an existing attachment', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const attachment = taskAttachmentsDb.create({
      taskId,
      fileName: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      storedPath: '/tmp/screenshot.png',
    });

    const evidence = taskEvidenceDb.create({
      taskId,
      kind: 'attachment',
      content: 'See attached screenshot',
      attachmentId: attachment.attachment_id,
    });

    assert.equal(evidence.attachment_id, attachment.attachment_id);
  });
});

test('an invalid kind is rejected by the CHECK constraint', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const db = getConnection();

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO task_evidence (evidence_id, task_id, kind, content) VALUES ('e1', ?, 'video', 'x')`,
          )
          .run(taskId),
      /CHECK constraint failed/,
    );
  });
});

test('listByTask returns only evidence for the requested task, oldest first', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const otherTaskId = createTask();

    const first = taskEvidenceDb.create({ taskId, kind: 'note', content: 'first' });
    const second = taskEvidenceDb.create({ taskId, kind: 'link', content: 'https://example.com/run/1' });
    taskEvidenceDb.create({ taskId: otherTaskId, kind: 'note', content: 'unrelated' });

    const entries = taskEvidenceDb.listByTask(taskId);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.evidence_id, first.evidence_id);
    assert.equal(entries[1]!.evidence_id, second.evidence_id);
  });
});

test('deleting a task cascades to its evidence', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    taskEvidenceDb.create({ taskId, kind: 'note', content: 'will be removed' });

    tasksDb.delete(taskId);

    assert.equal(taskEvidenceDb.listByTask(taskId).length, 0);
  });
});

test('deleting the referenced attachment clears attachment_id instead of removing the evidence', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const attachment = taskAttachmentsDb.create({
      taskId,
      fileName: 'log.txt',
      mimeType: 'text/plain',
      sizeBytes: 128,
      storedPath: '/tmp/log.txt',
    });
    const evidence = taskEvidenceDb.create({
      taskId,
      kind: 'attachment',
      content: 'See attached log',
      attachmentId: attachment.attachment_id,
    });

    taskAttachmentsDb.delete(attachment.attachment_id);

    const reloaded = taskEvidenceDb.get(evidence.evidence_id);
    assert.ok(reloaded);
    assert.equal(reloaded!.attachment_id, null);
  });
});

test('delete removes the evidence and returns whether a row was affected', async () => {
  await withIsolatedDatabase(() => {
    const taskId = createTask();
    const evidence = taskEvidenceDb.create({ taskId, kind: 'note', content: 'temp' });

    assert.equal(taskEvidenceDb.delete(evidence.evidence_id), true);
    assert.equal(taskEvidenceDb.get(evidence.evidence_id), null);
    assert.equal(taskEvidenceDb.delete(evidence.evidence_id), false);
  });
});
