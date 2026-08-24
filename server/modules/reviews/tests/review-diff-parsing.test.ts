import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionRow, TaskRow } from '@/modules/database/index.js';

import {
  formatCommentForSession,
  selectAuthorSession,
} from '../services/review-comment-delivery.service.js';
import { parseReviewDiffFiles } from '../services/review-diff.service.js';

function session(overrides: Partial<SessionRow>): SessionRow {
  return {
    session_id: 'session',
    provider: 'claude',
    provider_session_id: null,
    project_path: '/repo',
    jsonl_path: null,
    custom_name: null,
    profile_id: null,
    caveman_mode: null,
    isArchived: 0,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    worktree_path: null,
    worktree_branch: null,
    seed_primer_path: null,
    ...overrides,
  };
}

const TASK: TaskRow = {
  id: 'task-1',
  project_name: 'project-1',
  title: 'Employee form',
  description: null,
  stage: 'review',
  origin: 'user',
  origin_detail: null,
  assignee_profile_id: null,
  suggested_skill: null,
  worktree_branch: 'feature/x',
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
};

test('name-status and numstat are joined per file', () => {
  const files = parseReviewDiffFiles(
    ['M\tsrc/app.ts', 'A\tsrc/new.ts', 'D\tsrc/old.ts'].join('\n'),
    ['3\t1\tsrc/app.ts', '10\t0\tsrc/new.ts', '0\t7\tsrc/old.ts'].join('\n'),
  );

  assert.deepEqual(
    files.map((file) => [file.filePath, file.changeKind, file.additions, file.deletions]),
    [
      ['src/app.ts', 'modified', 3, 1],
      ['src/new.ts', 'added', 10, 0],
      ['src/old.ts', 'deleted', 0, 7],
    ],
  );
});

test('a rename keeps both sides of the move', () => {
  const files = parseReviewDiffFiles('R096\tsrc/old.ts\tsrc/new.ts', '2\t2\tsrc/new.ts');

  assert.equal(files.length, 1);
  assert.equal(files[0].changeKind, 'renamed');
  assert.equal(files[0].previousPath, 'src/old.ts');
  assert.equal(files[0].filePath, 'src/new.ts');
  assert.equal(files[0].additions, 2);
});

test('binary files report zero counts instead of NaN', () => {
  const files = parseReviewDiffFiles('M\tlogo.png', '-\t-\tlogo.png');

  assert.deepEqual([files[0].additions, files[0].deletions], [0, 0]);
});

test('blank and malformed lines are ignored', () => {
  assert.deepEqual(parseReviewDiffFiles('\n\n', '\n'), []);
  assert.deepEqual(parseReviewDiffFiles('garbage', ''), []);
});

test('the author session is the one on the task branch', () => {
  const picked = selectAuthorSession(
    [
      session({ session_id: 'other-branch', worktree_branch: 'feature/y' }),
      session({ session_id: 'right', worktree_branch: 'feature/x' }),
    ],
    TASK,
    'feature/x',
  );

  assert.equal(picked?.session_id, 'right');
});

test('the assignee breaks a tie, then recency', () => {
  const sessions = [
    session({ session_id: 'old', worktree_branch: 'feature/x', updated_at: '2026-01-01 00:00:00' }),
    session({ session_id: 'new', worktree_branch: 'feature/x', updated_at: '2026-02-01 00:00:00' }),
    session({
      session_id: 'assignee',
      worktree_branch: 'feature/x',
      profile_id: 'profile-1',
      updated_at: '2025-12-01 00:00:00',
    }),
  ];

  assert.equal(selectAuthorSession(sessions, TASK, 'feature/x')?.session_id, 'new');
  assert.equal(
    selectAuthorSession(sessions, { ...TASK, assignee_profile_id: 'profile-1' }, 'feature/x')
      ?.session_id,
    'assignee',
  );
});

test('archived sessions and unrelated branches are never picked', () => {
  assert.equal(
    selectAuthorSession(
      [session({ session_id: 'archived', worktree_branch: 'feature/x', isArchived: 1 })],
      TASK,
      'feature/x',
    ),
    null,
  );
  assert.equal(selectAuthorSession([session({ worktree_branch: null })], TASK, 'feature/x'), null);
});

test('the routed message names the file and the line', () => {
  const text = formatCommentForSession(
    {
      comment_id: 'c1',
      review_id: 'r1',
      file_path: 'src/app.ts',
      line_no: 42,
      body: 'Validate the CPF here',
      author: 'user',
      state: 'open',
      created_at: '2026-01-01 00:00:00',
    },
    TASK,
  );

  assert.match(text, /`src\/app\.ts:42`/);
  assert.match(text, /Employee form/);
  assert.match(text, /Validate the CPF here/);
});

test('a review-wide comment names no file', () => {
  const text = formatCommentForSession(
    {
      comment_id: 'c1',
      review_id: 'r1',
      file_path: '',
      line_no: null,
      body: 'Split this file',
      author: 'user',
      state: 'open',
      created_at: '2026-01-01 00:00:00',
    },
    TASK,
  );

  assert.match(text, /the review as a whole/);
});
