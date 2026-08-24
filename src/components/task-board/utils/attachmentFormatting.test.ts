import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatFileSize,
  isImageMimeType,
  TASK_ATTACHMENT_MAX_SIZE_BYTES,
  validateAttachmentSize,
} from './attachmentFormatting';

test('formatFileSize renders bytes, KB, MB and GB with the expected precision', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(1024 * 1024 * 3), '3.0 MB');
  assert.equal(formatFileSize(1024 * 1024 * 1024 * 2.5), '2.5 GB');
});

test('formatFileSize treats negative or non-finite input as empty', () => {
  assert.equal(formatFileSize(-5), '0 B');
  assert.equal(formatFileSize(Number.NaN), '0 B');
});

test('isImageMimeType accepts common raster/vector image types', () => {
  assert.equal(isImageMimeType('image/png'), true);
  assert.equal(isImageMimeType('image/jpeg'), true);
  assert.equal(isImageMimeType('image/svg+xml'), true);
  assert.equal(isImageMimeType(' image/webp '), true);
});

test('isImageMimeType rejects non-image and unknown types', () => {
  assert.equal(isImageMimeType('application/pdf'), false);
  assert.equal(isImageMimeType('text/plain'), false);
  assert.equal(isImageMimeType(''), false);
});

test('validateAttachmentSize allows files at or under the cap', () => {
  const result = validateAttachmentSize(TASK_ATTACHMENT_MAX_SIZE_BYTES, 'file.zip');
  assert.equal(result.ok, true);
});

test('validateAttachmentSize rejects files over the cap with a readable reason', () => {
  const result = validateAttachmentSize(TASK_ATTACHMENT_MAX_SIZE_BYTES + 1, 'huge.zip');
  assert.equal(result.ok, false);
  assert.match((result as { ok: false; reason: string }).reason, /huge\.zip/);
  assert.match((result as { ok: false; reason: string }).reason, /20 MB/);
});
