import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';
import type { TaskRow } from '@/modules/database/repositories/tasks.db.js';

export type TaskReviewState = 'open' | 'approved' | 'changes_requested' | 'closed';

export type TaskReviewRow = {
  review_id: string;
  task_id: string;
  state: TaskReviewState;
  created_at: string;
  updated_at: string;
};

/** A queue entry: the review plus the columns the queue list renders. */
export type TaskReviewWithTaskRow = TaskReviewRow & {
  task_title: string;
  task_project_name: string;
  task_stage: TaskRow['stage'];
  task_assignee_profile_id: string | null;
  task_worktree_branch: string | null;
};

/**
 * States in which a review is still waiting on a human. Kept in sync with the
 * partial unique index that allows only one such row per task.
 */
export const LIVE_REVIEW_STATES: TaskReviewState[] = ['open', 'changes_requested'];

const REVIEW_COLUMNS = 'review_id, task_id, state, created_at, updated_at';

const REVIEW_WITH_TASK_COLUMNS = `
  r.review_id, r.task_id, r.state, r.created_at, r.updated_at,
  t.title AS task_title,
  t.project_name AS task_project_name,
  t.stage AS task_stage,
  t.assignee_profile_id AS task_assignee_profile_id,
  t.worktree_branch AS task_worktree_branch
`;

function getReviewById(reviewId: string): TaskReviewRow | null {
  const db = getConnection();
  const row = db
    .prepare(`SELECT ${REVIEW_COLUMNS} FROM task_reviews WHERE review_id = ?`)
    .get(reviewId) as TaskReviewRow | undefined;
  return row ?? null;
}

export const taskReviewsDb = {
  create(taskId: string): TaskReviewRow {
    const db = getConnection();
    const reviewId = randomUUID();
    db.prepare("INSERT INTO task_reviews (review_id, task_id, state) VALUES (?, ?, 'open')").run(
      reviewId,
      taskId,
    );
    return getReviewById(reviewId) as TaskReviewRow;
  },

  get(reviewId: string): TaskReviewRow | null {
    return getReviewById(reviewId);
  },

  /** The review still waiting on a human for this task, if any. */
  getLiveByTask(taskId: string): TaskReviewRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${REVIEW_COLUMNS} FROM task_reviews
         WHERE task_id = ? AND state IN ('open', 'changes_requested')`,
      )
      .get(taskId) as TaskReviewRow | undefined;
    return row ?? null;
  },

  getWithTask(reviewId: string): TaskReviewWithTaskRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${REVIEW_WITH_TASK_COLUMNS}
         FROM task_reviews r JOIN tasks t ON t.id = r.task_id
         WHERE r.review_id = ?`,
      )
      .get(reviewId) as TaskReviewWithTaskRow | undefined;
    return row ?? null;
  },

  /**
   * The review queue, newest activity first. `states` filters by review state;
   * `projectName` narrows to one board. Both are optional.
   */
  listWithTask(filters: { states?: TaskReviewState[]; projectName?: string } = {}): TaskReviewWithTaskRow[] {
    const db = getConnection();
    const conditions: string[] = [];
    const values: string[] = [];

    if (filters.states && filters.states.length > 0) {
      conditions.push(`r.state IN (${filters.states.map(() => '?').join(', ')})`);
      values.push(...filters.states);
    }
    if (filters.projectName) {
      conditions.push('t.project_name = ?');
      values.push(filters.projectName);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return db
      .prepare(
        `SELECT ${REVIEW_WITH_TASK_COLUMNS}
         FROM task_reviews r JOIN tasks t ON t.id = r.task_id
         ${where}
         ORDER BY datetime(r.updated_at) DESC, r.rowid DESC`,
      )
      .all(...values) as TaskReviewWithTaskRow[];
  },

  /** Moves a review to another state and bumps `updated_at`. */
  setState(reviewId: string, state: TaskReviewState): TaskReviewRow | null {
    const db = getConnection();
    db.prepare(
      'UPDATE task_reviews SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE review_id = ?',
    ).run(state, reviewId);
    return getReviewById(reviewId);
  },

  /** Bumps `updated_at` only — used when a comment lands on an unchanged review. */
  touch(reviewId: string): TaskReviewRow | null {
    const db = getConnection();
    db.prepare('UPDATE task_reviews SET updated_at = CURRENT_TIMESTAMP WHERE review_id = ?').run(
      reviewId,
    );
    return getReviewById(reviewId);
  },

  delete(reviewId: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM task_reviews WHERE review_id = ?').run(reviewId).changes > 0;
  },
};
