import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type TaskStage = 'backlog' | 'in_progress' | 'review' | 'done';
export type TaskOrigin = 'user' | 'agent' | 'automation';

export type TaskRow = {
  id: string;
  project_name: string;
  title: string;
  description: string | null;
  stage: TaskStage;
  origin: TaskOrigin;
  origin_detail: string | null;
  assignee_profile_id: string | null;
  suggested_skill: string | null;
  worktree_branch: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateTaskInput = {
  title: string;
  projectName: string;
  description?: string | null;
  origin?: TaskOrigin;
  originDetail?: string | null;
  assigneeProfileId?: string | null;
  suggestedSkill?: string | null;
  worktreeBranch?: string | null;
};

export type UpdateTaskInput = {
  stage?: TaskStage;
  title?: string;
  description?: string | null;
  assigneeProfileId?: string | null;
  suggestedSkill?: string | null;
  worktreeBranch?: string | null;
};

export type ProfileFallbackAuditRow = {
  id: string;
  org_id: string;
  profile_id: string;
  project_name: string;
  session_id: string | null;
  reason: string;
  primary_usage_pct: number | null;
  created_at: string;
};

const TASK_COLUMNS =
  'id, project_name, title, description, stage, origin, origin_detail, assignee_profile_id, suggested_skill, worktree_branch, created_at, updated_at';

const AUDIT_COLUMNS = 'id, org_id, profile_id, project_name, session_id, reason, primary_usage_pct, created_at';

function getTaskById(id: string): TaskRow | null {
  const db = getConnection();
  const row = db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(id) as
    | TaskRow
    | undefined;
  return row ?? null;
}

export const tasksDb = {
  create(input: CreateTaskInput): TaskRow {
    const db = getConnection();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO tasks (
         id, project_name, title, description, stage, origin, origin_detail,
         assignee_profile_id, suggested_skill, worktree_branch
       ) VALUES (?, ?, ?, ?, 'backlog', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.projectName,
      input.title,
      input.description ?? null,
      input.origin ?? 'user',
      input.originDetail ?? null,
      input.assigneeProfileId ?? null,
      input.suggestedSkill ?? null,
      input.worktreeBranch ?? null,
    );
    return getTaskById(id) as TaskRow;
  },

  /** Grouped by stage first (board column order), newest-updated first within each. */
  listByProject(projectName: string): TaskRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE project_name = ?
         ORDER BY CASE stage
             WHEN 'backlog' THEN 0
             WHEN 'in_progress' THEN 1
             WHEN 'review' THEN 2
             WHEN 'done' THEN 3
           END,
           datetime(updated_at) DESC,
           rowid DESC`,
      )
      .all(projectName) as TaskRow[];
  },

  get(id: string): TaskRow | null {
    return getTaskById(id);
  },

  /** Partial update; only the keys present in `fields` are written. Always bumps `updated_at`. */
  update(id: string, fields: UpdateTaskInput): TaskRow | null {
    const db = getConnection();
    const assignments: string[] = [];
    const values: (string | null)[] = [];

    if (fields.stage !== undefined) {
      assignments.push('stage = ?');
      values.push(fields.stage);
    }
    if (fields.title !== undefined) {
      assignments.push('title = ?');
      values.push(fields.title);
    }
    if (fields.description !== undefined) {
      assignments.push('description = ?');
      values.push(fields.description);
    }
    if (fields.assigneeProfileId !== undefined) {
      assignments.push('assignee_profile_id = ?');
      values.push(fields.assigneeProfileId);
    }
    if (fields.suggestedSkill !== undefined) {
      assignments.push('suggested_skill = ?');
      values.push(fields.suggestedSkill);
    }
    if (fields.worktreeBranch !== undefined) {
      assignments.push('worktree_branch = ?');
      values.push(fields.worktreeBranch);
    }

    if (assignments.length === 0) {
      return getTaskById(id);
    }

    assignments.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
    return getTaskById(id);
  },

  delete(id: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  },

  fallbackAudit: {
    insert(entry: {
      orgId: string;
      profileId: string;
      projectName: string;
      sessionId?: string | null;
      reason: string;
      primaryUsagePct?: number | null;
    }): ProfileFallbackAuditRow {
      const db = getConnection();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO profile_fallback_audit (
           id, org_id, profile_id, project_name, session_id, reason, primary_usage_pct
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        entry.orgId,
        entry.profileId,
        entry.projectName,
        entry.sessionId ?? null,
        entry.reason,
        entry.primaryUsagePct ?? null,
      );
      return db
        .prepare(`SELECT ${AUDIT_COLUMNS} FROM profile_fallback_audit WHERE id = ?`)
        .get(id) as ProfileFallbackAuditRow;
    },

    listRecent(limit: number): ProfileFallbackAuditRow[] {
      const db = getConnection();
      return db
        .prepare(
          `SELECT ${AUDIT_COLUMNS} FROM profile_fallback_audit
           ORDER BY datetime(created_at) DESC, rowid DESC
           LIMIT ?`,
        )
        .all(limit) as ProfileFallbackAuditRow[];
    },
  },
};
