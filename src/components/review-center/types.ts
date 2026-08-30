// Frontend mirror of the Reviews module's contracts
// (server/modules/database/repositories/task-reviews.db.ts, review-comments.db.ts,
// server/modules/reviews/**). The frontend keeps its own copy of server contracts
// instead of importing server modules — same convention as `Task` in
// `components/task-board/types.ts`.

import type { Task } from '../task-board/types';

export type ReviewState = 'open' | 'approved' | 'changes_requested' | 'closed';
export type ReviewCommentAuthor = 'user' | 'agent';
export type ReviewCommentState = 'open' | 'resolved';

/** A queue entry: the review joined with the columns its card renders. */
export interface ReviewQueueEntry {
  review_id: string;
  task_id: string;
  state: ReviewState;
  created_at: string;
  updated_at: string;
  task_title: string;
  task_project_name: string;
  task_stage: Task['stage'];
  task_assignee_profile_id: string | null;
  task_worktree_branch: string | null;
  /** AI-written summary (what changed / risks / UAT checklist); null until generated. */
  ai_brief: string | null;
}

export interface ReviewComment {
  comment_id: string;
  review_id: string;
  /** Empty for a comment about the review as a whole. */
  file_path: string;
  line_no: number | null;
  body: string;
  author: ReviewCommentAuthor;
  state: ReviewCommentState;
  created_at: string;
}

export type ReviewDiffChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'changed';

export interface ReviewDiffFile {
  filePath: string;
  previousPath: string | null;
  changeKind: ReviewDiffChangeKind;
  additions: number;
  deletions: number;
}

export interface ReviewDetail {
  review: ReviewQueueEntry;
  task: Task;
  worktree: {
    repositoryRoot: string;
    worktreePath: string;
    branch: string;
    baseBranch: string;
  };
  files: ReviewDiffFile[];
  comments: ReviewComment[];
}

/** Where a comment ended up after the server tried to page the agent. */
export type ReviewRoutingStatus =
  | 'delivered'
  | 'no_session'
  | 'session_busy'
  | 'not_configured'
  | 'failed';

export interface ReviewCommentRouting {
  routed: boolean;
  status: ReviewRoutingStatus;
  sessionId: string | null;
}

export interface ReviewMergeResult {
  mergedBranch: string;
  targetBranch: string;
  squash: boolean;
  cleanupError: string | null;
}

export type ReviewUpdateAction = 'opened' | 'updated' | 'commented' | 'closed';

/** Shape of the `review_update` WS frame broadcast by `broadcastReviewUpdate`. */
export interface ReviewUpdateEvent {
  kind: 'review_update';
  action: ReviewUpdateAction;
  review: ReviewQueueEntry;
}
