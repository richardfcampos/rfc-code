import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildStoredAttachmentFilename,
  deleteStoredAttachmentFile,
  getTaskAttachmentsDir,
} from '@/modules/tasks/services/task-attachments.storage.js';

test('buildStoredAttachmentFilename sanitizes unsafe characters and stays unique per call', () => {
  const first = buildStoredAttachmentFilename('../../etc/passwd; rm -rf.png');
  const second = buildStoredAttachmentFilename('../../etc/passwd; rm -rf.png');

  assert.doesNotMatch(first, /[/\\]/);
  assert.notEqual(first, second);
  // Only [a-zA-Z0-9.-] survive unsanitized; the rest — path separators,
  // spaces, ";" — become "_". Prefixed with a unique numeric suffix.
  assert.match(first, /^\d+-\d+-.*etc_passwd.*rm.*-rf\.png$/);
});

test('buildStoredAttachmentFilename keeps a normal filename mostly intact', () => {
  const stored = buildStoredAttachmentFilename('design-spec.v2.pdf');
  assert.match(stored, /-design-spec\.v2\.pdf$/);
});

test('deleteStoredAttachmentFile removes a file inside the attachments folder', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await mkdtemp(path.join(tmpdir(), 'task-attachments-home-'));
  process.env.HOME = tempHome;

  try {
    const attachmentsDir = getTaskAttachmentsDir();
    await mkdir(attachmentsDir, { recursive: true });
    const filePath = path.join(attachmentsDir, 'kept.txt');
    await writeFile(filePath, 'hello');

    await deleteStoredAttachmentFile(filePath);

    await assert.rejects(() => readFile(filePath));
  } finally {
    process.env.HOME = previousHome;
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('deleteStoredAttachmentFile is a no-op for a missing file', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await mkdtemp(path.join(tmpdir(), 'task-attachments-home-'));
  process.env.HOME = tempHome;

  try {
    const attachmentsDir = getTaskAttachmentsDir();
    await mkdir(attachmentsDir, { recursive: true });

    await assert.doesNotReject(() => deleteStoredAttachmentFile(path.join(attachmentsDir, 'missing.txt')));
  } finally {
    process.env.HOME = previousHome;
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('deleteStoredAttachmentFile refuses a path outside the attachments folder', async () => {
  const previousHome = process.env.HOME;
  const tempHome = await mkdtemp(path.join(tmpdir(), 'task-attachments-home-'));
  process.env.HOME = tempHome;

  const outsideDir = await mkdtemp(path.join(tmpdir(), 'task-attachments-outside-'));
  const outsideFile = path.join(outsideDir, 'sensitive.txt');
  await writeFile(outsideFile, 'do not delete');

  try {
    await deleteStoredAttachmentFile(outsideFile);
    const contents = await readFile(outsideFile, 'utf8');
    assert.equal(contents, 'do not delete');
  } finally {
    process.env.HOME = previousHome;
    await rm(tempHome, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});
