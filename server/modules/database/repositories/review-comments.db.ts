import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type ReviewCommentAuthor = 'user' | 'agent';
export type ReviewCommentState = 'open' | 'resolved';

export type ReviewCommentRow = {
  comment_id: string;
  review_id: string;
  file_path: string;
  line_no: number | null;
  body: string;
  author: ReviewCommentAuthor;
  state: ReviewCommentState;
  created_at: string;
};

export type CreateReviewCommentInput = {
  reviewId: string;
  filePath: string;
  lineNo?: number | null;
  body: string;
  author?: ReviewCommentAuthor;
};

const COMMENT_COLUMNS =
  'comment_id, review_id, file_path, line_no, body, author, state, created_at';

function getCommentById(commentId: string): ReviewCommentRow | null {
  const db = getConnection();
  const row = db
    .prepare(`SELECT ${COMMENT_COLUMNS} FROM review_comments WHERE comment_id = ?`)
    .get(commentId) as ReviewCommentRow | undefined;
  return row ?? null;
}

export const reviewCommentsDb = {
  create(input: CreateReviewCommentInput): ReviewCommentRow {
    const db = getConnection();
    const commentId = randomUUID();
    db.prepare(
      `INSERT INTO review_comments (comment_id, review_id, file_path, line_no, body, author, state)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
    ).run(
      commentId,
      input.reviewId,
      input.filePath,
      input.lineNo ?? null,
      input.body,
      input.author ?? 'user',
    );
    return getCommentById(commentId) as ReviewCommentRow;
  },

  get(commentId: string): ReviewCommentRow | null {
    return getCommentById(commentId);
  },

  /** Every comment on a review, oldest first — the thread reads top to bottom. */
  listByReview(reviewId: string): ReviewCommentRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${COMMENT_COLUMNS} FROM review_comments
         WHERE review_id = ?
         ORDER BY datetime(created_at) ASC, rowid ASC`,
      )
      .all(reviewId) as ReviewCommentRow[];
  },

  listByReviewAndFile(reviewId: string, filePath: string): ReviewCommentRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${COMMENT_COLUMNS} FROM review_comments
         WHERE review_id = ? AND file_path = ?
         ORDER BY datetime(created_at) ASC, rowid ASC`,
      )
      .all(reviewId, filePath) as ReviewCommentRow[];
  },

  setState(commentId: string, state: ReviewCommentState): ReviewCommentRow | null {
    const db = getConnection();
    db.prepare('UPDATE review_comments SET state = ? WHERE comment_id = ?').run(state, commentId);
    return getCommentById(commentId);
  },

  /** Bulk-resolves a review's open comments; used when the review is approved. */
  resolveAllOpen(reviewId: string): number {
    const db = getConnection();
    return db
      .prepare("UPDATE review_comments SET state = 'resolved' WHERE review_id = ? AND state = 'open'")
      .run(reviewId).changes;
  },

  delete(commentId: string): boolean {
    const db = getConnection();
    return db.prepare('DELETE FROM review_comments WHERE comment_id = ?').run(commentId).changes > 0;
  },
};
