/**
 * File storage plumbing for task attachments: `server/modules/tasks`.
 *
 * Mirrors the storage idiom in `modules/assets`
 * (`services/image-assets.service.ts`): one flat global folder, a
 * random-suffixed sanitized filename per upload, and no mime-type allow-list
 * — a task attachment can be any document or image the board wants to keep,
 * never sent to a model API as inline content. Kept inside the tasks module
 * (rather than reusing `modules/assets`) so task attachments have their own
 * folder, their own size cap, and their own lifecycle (deleted with the
 * attachment row, not kept forever like chat upload assets).
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TASK_ATTACHMENTS_DIRNAME = 'task-attachments';

/** Task attachments (documents + images) are capped higher than chat images, same as the generic chat-file upload. */
export const TASK_ATTACHMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024;

/** Global storage folder for uploaded task attachments. */
export function getTaskAttachmentsDir(): string {
  return path.join(os.homedir(), '.cloudcli', TASK_ATTACHMENTS_DIRNAME);
}

/** Creates the global task-attachments folder if needed and returns it. */
export async function ensureTaskAttachmentsDir(): Promise<string> {
  const dir = getTaskAttachmentsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Multer destination filename: unique-suffixed and sanitized, same idiom as modules/assets. */
export function buildStoredAttachmentFilename(originalName: string): string {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${uniqueSuffix}-${sanitizedName}`;
}

/**
 * Deletes one stored attachment file. A path outside the attachments folder
 * is refused rather than unlinked (defense in depth in case a stored_path
 * was ever tampered with); a file that is already gone (ENOENT) is treated
 * as success. Both are non-fatal by design: the caller has already removed
 * the database row that made the file reachable, so a stray file on disk is
 * cleanup debt, not a correctness problem.
 */
export async function deleteStoredAttachmentFile(storedPath: string): Promise<void> {
  const attachmentsDir = path.resolve(getTaskAttachmentsDir()) + path.sep;
  const resolved = path.resolve(storedPath);
  if (!resolved.startsWith(attachmentsDir)) {
    console.error('[tasks] refusing to delete an attachment file outside the attachments folder:', storedPath);
    return;
  }

  try {
    await fs.unlink(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.error('[tasks] failed to delete attachment file:', error);
    }
  }
}
