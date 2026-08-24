import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type TaskAttachmentRow = {
  attachment_id: string;
  task_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  stored_path: string;
  created_at: string;
};

export type CreateTaskAttachmentInput = {
  taskId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storedPath: string;
};

const ATTACHMENT_COLUMNS =
  'attachment_id, task_id, file_name, mime_type, size_bytes, stored_path, created_at';

function getAttachmentById(attachmentId: string): TaskAttachmentRow | null {
  const db = getConnection();
  const row = db
    .prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments WHERE attachment_id = ?`)
    .get(attachmentId) as TaskAttachmentRow | undefined;
  return row ?? null;
}

export const taskAttachmentsDb = {
  create(input: CreateTaskAttachmentInput): TaskAttachmentRow {
    const db = getConnection();
    const attachmentId = randomUUID();
    db.prepare(
      `INSERT INTO task_attachments (
         attachment_id, task_id, file_name, mime_type, size_bytes, stored_path
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      attachmentId,
      input.taskId,
      input.fileName,
      input.mimeType,
      input.sizeBytes,
      input.storedPath,
    );
    return getAttachmentById(attachmentId) as TaskAttachmentRow;
  },

  get(attachmentId: string): TaskAttachmentRow | null {
    return getAttachmentById(attachmentId);
  },

  /** Oldest first, so a task's attachments list reads like an upload timeline. */
  listByTask(taskId: string): TaskAttachmentRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments
         WHERE task_id = ?
         ORDER BY datetime(created_at) ASC, rowid ASC`,
      )
      .all(taskId) as TaskAttachmentRow[];
  },

  delete(attachmentId: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM task_attachments WHERE attachment_id = ?').run(attachmentId).changes > 0;
  },
};
