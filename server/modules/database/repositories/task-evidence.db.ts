import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type TaskEvidenceKind = 'note' | 'link' | 'attachment';

export type TaskEvidenceRow = {
  evidence_id: string;
  task_id: string;
  kind: TaskEvidenceKind;
  content: string;
  attachment_id: string | null;
  created_at: string;
};

export type CreateTaskEvidenceInput = {
  taskId: string;
  kind: TaskEvidenceKind;
  content: string;
  attachmentId?: string | null;
};

const EVIDENCE_COLUMNS = 'evidence_id, task_id, kind, content, attachment_id, created_at';

function getEvidenceById(evidenceId: string): TaskEvidenceRow | null {
  const db = getConnection();
  const row = db
    .prepare(`SELECT ${EVIDENCE_COLUMNS} FROM task_evidence WHERE evidence_id = ?`)
    .get(evidenceId) as TaskEvidenceRow | undefined;
  return row ?? null;
}

export const taskEvidenceDb = {
  create(input: CreateTaskEvidenceInput): TaskEvidenceRow {
    const db = getConnection();
    const evidenceId = randomUUID();
    db.prepare(
      `INSERT INTO task_evidence (
         evidence_id, task_id, kind, content, attachment_id
       ) VALUES (?, ?, ?, ?, ?)`,
    ).run(evidenceId, input.taskId, input.kind, input.content, input.attachmentId ?? null);
    return getEvidenceById(evidenceId) as TaskEvidenceRow;
  },

  get(evidenceId: string): TaskEvidenceRow | null {
    return getEvidenceById(evidenceId);
  },

  /** Oldest first, so a task's evidence reads like a chronological work log. */
  listByTask(taskId: string): TaskEvidenceRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${EVIDENCE_COLUMNS} FROM task_evidence
         WHERE task_id = ?
         ORDER BY datetime(created_at) ASC, rowid ASC`,
      )
      .all(taskId) as TaskEvidenceRow[];
  },

  delete(evidenceId: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM task_evidence WHERE evidence_id = ?').run(evidenceId).changes > 0;
  },
};
