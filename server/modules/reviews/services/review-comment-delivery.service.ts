/**
 * Routes a review comment back to the session that wrote the code.
 *
 * Delivery is best effort by contract: the comment is already persisted when
 * this runs, so every failure mode here degrades to "the comment is in the
 * Review Center but nobody was paged", never to a lost comment or a failed
 * request. The outcome is reported back so the UI can say which happened.
 */

import type { ReviewCommentRow, SessionRow, TaskRow } from '@/modules/database/index.js';
import { isAuxiliarySessionName } from '@/shared/utils.js';

export type ReviewCommentRoutingStatus =
  | 'delivered'
  | 'no_session'
  | 'session_busy'
  | 'not_configured'
  | 'failed';

export type ReviewCommentRouting = {
  routed: boolean;
  status: ReviewCommentRoutingStatus;
  sessionId: string | null;
};

/**
 * Sends one user-role message into an existing session. Resolves to false when
 * the session cannot take a message right now (a run is already in flight).
 */
export type SessionMessageSender = (input: {
  session: SessionRow;
  text: string;
}) => Promise<boolean>;

export type ReviewCommentDeliveryDeps = {
  listSessionsByProjectPath: (projectPath: string) => SessionRow[];
  /** Null until the server wires the chat runtime in at boot. */
  sendSessionMessage: SessionMessageSender | null;
};

/**
 * Picks the session most likely to be the comment's author.
 *
 * Sessions are grouped under the repository, so the branch is what separates
 * one agent's worktree session from another's; the assignee profile breaks
 * remaining ties, and recency breaks the rest. Returns null rather than
 * guessing when nothing matches the branch — paging the wrong agent is worse
 * than paging nobody.
 *
 * An auxiliary session — one dispatched to work alongside the branch rather
 * than to continue its authorship, tagged at spawn (see
 * `AUXILIARY_SESSION_DISPLAY_NAME`) — is excluded before recency ever comes
 * into it. Without this, a rule that reacts to the card reaching review and
 * runs on the same branch would routinely be the *newest* session there and
 * win the recency tie-break, paging itself instead of the session that
 * actually wrote the code under review.
 */
export function selectAuthorSession(
  sessions: SessionRow[],
  task: TaskRow,
  branch: string,
): SessionRow | null {
  const candidates = sessions.filter(
    (session) =>
      session.isArchived !== 1 &&
      session.worktree_branch === branch &&
      !isAuxiliarySessionName(session.custom_name),
  );
  if (candidates.length === 0) {
    return null;
  }

  const byAssignee = task.assignee_profile_id
    ? candidates.filter((session) => session.profile_id === task.assignee_profile_id)
    : [];
  const pool = byAssignee.length > 0 ? byAssignee : candidates;

  return [...pool].sort((left, right) =>
    (right.updated_at ?? '').localeCompare(left.updated_at ?? ''),
  )[0];
}

/** Renders the comment the way the agent will read it in its transcript. */
export function formatCommentForSession(
  comment: ReviewCommentRow,
  task: TaskRow,
): string {
  const location = comment.file_path
    ? `\`${comment.file_path}${comment.line_no === null ? '' : `:${comment.line_no}`}\``
    : 'the review as a whole';

  return [
    `Review comment on ${location} (task "${task.title}"):`,
    '',
    comment.body,
    '',
    'Address it in the task worktree and reply when done.',
  ].join('\n');
}

/**
 * Delivers a persisted comment to the author session, if one can be found and
 * is free to take a turn.
 */
export async function routeCommentToAuthorSession(
  input: { comment: ReviewCommentRow; task: TaskRow; repositoryRoot: string; branch: string },
  deps: ReviewCommentDeliveryDeps,
): Promise<ReviewCommentRouting> {
  let session: SessionRow | null = null;
  try {
    session = selectAuthorSession(
      deps.listSessionsByProjectPath(input.repositoryRoot),
      input.task,
      input.branch,
    );
  } catch (error) {
    console.error('[reviews] failed to look up the author session:', error);
    return { routed: false, status: 'failed', sessionId: null };
  }

  if (!session) {
    return { routed: false, status: 'no_session', sessionId: null };
  }
  if (!deps.sendSessionMessage) {
    return { routed: false, status: 'not_configured', sessionId: session.session_id };
  }

  try {
    const delivered = await deps.sendSessionMessage({
      session,
      text: formatCommentForSession(input.comment, input.task),
    });
    return {
      routed: delivered,
      status: delivered ? 'delivered' : 'session_busy',
      sessionId: session.session_id,
    };
  } catch (error) {
    console.error('[reviews] failed to route a comment to its author session:', error);
    return { routed: false, status: 'failed', sessionId: session.session_id };
  }
}
