/**
 * Covers `selectAuthorSession`'s branch/recency selection, and specifically
 * the case that used to misroute: an auxiliary session dispatched onto the
 * same branch as the ticket's own author (a rule that reacts to the card
 * reaching review, for one) is newer than the author's own session and would
 * otherwise win the recency tie-break.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReviewCommentRow, SessionRow, TaskRow } from '@/modules/database/index.js';
import { AUXILIARY_SESSION_DISPLAY_NAME } from '@/shared/utils.js';

import { routeCommentToAuthorSession, selectAuthorSession } from '../services/review-comment-delivery.service.js';

const COMMENT: ReviewCommentRow = {
  comment_id: 'c1',
  review_id: 'r1',
  file_path: 'src/board.ts',
  line_no: 12,
  body: 'Please fix this',
  author: 'user',
  state: 'open',
  created_at: '2026-08-24T00:00:00.000Z',
};

const TASK: TaskRow = {
  id: 'task-1',
  project_name: 'my-app',
  title: 'Ship the board',
  description: 'A card an agent should pick up',
  stage: 'review',
  origin: 'user',
  origin_detail: null,
  assignee_profile_id: null,
  suggested_skill: null,
  worktree_branch: 'auto/task-1',
  created_at: '2026-08-24T00:00:00.000Z',
  updated_at: '2026-08-24T00:00:00.000Z',
};

function session(overrides: Partial<SessionRow>): SessionRow {
  return {
    session_id: 'session-default',
    provider: 'claude',
    provider_session_id: null,
    project_path: '/home/dev/my-app',
    jsonl_path: null,
    custom_name: null,
    profile_id: null,
    caveman_mode: null,
    isArchived: 0,
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
    worktree_path: '/worktrees/auto/task-1',
    worktree_branch: 'auto/task-1',
    seed_primer_path: null,
    ...overrides,
  };
}

test('a lone session on the branch is picked', () => {
  const author = session({ session_id: 'author', updated_at: '2026-08-24T01:00:00.000Z' });

  const picked = selectAuthorSession([author], TASK, 'auto/task-1');

  assert.equal(picked?.session_id, 'author');
});

test('an auxiliary session on the same branch is excluded even though it is newer', () => {
  const author = session({ session_id: 'author', updated_at: '2026-08-24T01:00:00.000Z' });
  const auxiliary = session({
    session_id: 'auxiliary',
    updated_at: '2026-08-24T02:00:00.000Z',
    custom_name: AUXILIARY_SESSION_DISPLAY_NAME,
  });

  const picked = selectAuthorSession([author, auxiliary], TASK, 'auto/task-1');

  assert.equal(picked?.session_id, 'author');
});

test('two genuine human sessions on the same branch still fall back to recency', () => {
  const older = session({ session_id: 'older', updated_at: '2026-08-24T01:00:00.000Z' });
  const newer = session({ session_id: 'newer', updated_at: '2026-08-24T02:00:00.000Z' });

  const picked = selectAuthorSession([older, newer], TASK, 'auto/task-1');

  assert.equal(picked?.session_id, 'newer');
});

test('only an auxiliary session on the branch is a clean no-match, not a wrong match', () => {
  const auxiliary = session({ session_id: 'auxiliary', custom_name: AUXILIARY_SESSION_DISPLAY_NAME });

  const picked = selectAuthorSession([auxiliary], TASK, 'auto/task-1');

  assert.equal(picked, null);
});

test('a session on a different branch is never a candidate regardless of its name', () => {
  const other = session({ session_id: 'other-branch', worktree_branch: 'auto/task-2' });

  const picked = selectAuthorSession([other], TASK, 'auto/task-1');

  assert.equal(picked, null);
});

test('routing end to end skips the auxiliary session and delivers to the author', async () => {
  const author = session({ session_id: 'author', updated_at: '2026-08-24T01:00:00.000Z' });
  const auxiliary = session({
    session_id: 'auxiliary',
    updated_at: '2026-08-24T02:00:00.000Z',
    custom_name: AUXILIARY_SESSION_DISPLAY_NAME,
  });
  const delivered: { session: SessionRow; text: string }[] = [];

  const routing = await routeCommentToAuthorSession(
    {
      comment: COMMENT,
      task: TASK,
      repositoryRoot: '/home/dev/my-app',
      branch: 'auto/task-1',
    },
    {
      listSessionsByProjectPath: () => [auxiliary, author],
      sendSessionMessage: async (input) => {
        delivered.push(input);
        return true;
      },
    },
  );

  assert.equal(routing.status, 'delivered');
  assert.equal(routing.sessionId, 'author');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].session.session_id, 'author');
  assert.match(delivered[0].text, /Please fix this/);
});
