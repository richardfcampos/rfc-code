import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project, ProjectSession } from '../../../types/app';
import type { TaskMasterTask } from '../../task-master/types';

import { buildOverviewData, FALLBACK_SESSION_TITLE, type OverviewRunningSession } from './overview-data';

const NOW = new Date('2026-08-30T12:00:00.000Z');

const hoursAgo = (hours: number): string =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  projectId: 'proj-a',
  displayName: 'Project A',
  fullPath: '/workspace/project-a',
  sessions: [],
  ...overrides,
});

const makeSession = (overrides: Record<string, unknown> = {}): ProjectSession => ({
  id: 'session-1',
  provider: 'claude',
  summary: 'Fix the flaky test',
  lastActivity: hoursAgo(1),
  worktreePath: null,
  worktreeBranch: null,
  taskId: null,
  ...overrides,
});

const makeTask = (overrides: Partial<TaskMasterTask> = {}): TaskMasterTask => ({
  id: 1,
  title: 'Build the thing',
  status: 'pending',
  ...overrides,
});

const build = (input: {
  projects?: Project[];
  running?: OverviewRunningSession[];
  tasksByProject?: Map<string, TaskMasterTask[]>;
}) =>
  buildOverviewData({
    projects: input.projects ?? [],
    running: input.running ?? [],
    tasksByProject: input.tasksByProject ?? new Map(),
    now: NOW,
  });

test('keeps recent sessions and drops sessions idle for over 24 hours', () => {
  const data = build({
    projects: [
      makeProject({
        sessions: [
          makeSession({ id: 'recent', lastActivity: hoursAgo(23) }),
          makeSession({ id: 'stale', lastActivity: hoursAgo(25) }),
        ],
      }),
    ],
  });

  assert.deepEqual(data.sessions.map((s) => s.id), ['recent']);
});

test('a running session is kept even when its last activity is old', () => {
  const data = build({
    projects: [
      makeProject({ sessions: [makeSession({ id: 'old-but-running', lastActivity: hoursAgo(48) })] }),
    ],
    running: [{ sessionId: 'old-but-running' }],
  });

  assert.equal(data.sessions.length, 1);
  assert.equal(data.sessions[0].status, 'run');
});

test('needing attention wins over running and statusText passes through', () => {
  const data = build({
    projects: [makeProject({ sessions: [makeSession({ id: 'blocked' })] })],
    running: [{ sessionId: 'blocked', needsAttention: true, statusText: 'Waiting for approval: Bash' }],
  });

  assert.equal(data.sessions[0].status, 'attn');
  assert.equal(data.sessions[0].statusText, 'Waiting for approval: Bash');
  assert.equal(data.counts.attn, 1);
  assert.equal(data.counts.running, 0);
});

test('idle sessions carry no statusText and titles fall back when summary is empty', () => {
  const data = build({
    projects: [makeProject({ sessions: [makeSession({ id: 'idle', summary: '' })] })],
  });

  assert.equal(data.sessions[0].status, 'idle');
  assert.equal(data.sessions[0].statusText, null);
  assert.equal(data.sessions[0].title, FALLBACK_SESSION_TITLE);
});

test('worktree label prefers the branch and falls back to the path basename', () => {
  const data = build({
    projects: [
      makeProject({
        sessions: [
          makeSession({ id: 'branchy', worktreePath: '/wt/feature-x', worktreeBranch: 'feature/x' }),
          makeSession({ id: 'pathy', worktreePath: '/wt/feature-y', worktreeBranch: null }),
        ],
      }),
    ],
  });

  const byId = new Map(data.sessions.map((s) => [s.id, s]));
  assert.equal(byId.get('branchy')?.worktreeLabel, 'feature/x');
  assert.equal(byId.get('pathy')?.worktreeLabel, 'feature-y');
});

test('taskRef resolves against the owning project tasks and unresolvable links become null', () => {
  const data = build({
    projects: [
      makeProject({
        sessions: [
          makeSession({ id: 'linked', taskId: '2' }),
          makeSession({ id: 'dangling', taskId: '99' }),
        ],
      }),
    ],
    tasksByProject: new Map([
      ['proj-a', [makeTask({ id: 2, title: 'Ship it', status: 'in-progress' })]],
    ]),
  });

  const byId = new Map(data.sessions.map((s) => [s.id, s]));
  assert.deepEqual(byId.get('linked')?.taskRef, { id: '2', title: 'Ship it', status: 'in-progress' });
  assert.equal(byId.get('dangling')?.taskRef, null);
});

test('sessions are ordered most recent first', () => {
  const data = build({
    projects: [
      makeProject({
        sessions: [
          makeSession({ id: 'older', lastActivity: hoursAgo(5) }),
          makeSession({ id: 'newer', lastActivity: hoursAgo(1) }),
        ],
      }),
    ],
  });

  assert.deepEqual(data.sessions.map((s) => s.id), ['newer', 'older']);
});

test('tasks are sorted in-progress, review, pending, others, then done flagged last', () => {
  const data = build({
    projects: [makeProject()],
    tasksByProject: new Map([
      [
        'proj-a',
        [
          makeTask({ id: 1, status: 'done' }),
          makeTask({ id: 2, status: 'pending' }),
          makeTask({ id: 3, status: 'review' }),
          makeTask({ id: 4, status: 'blocked' }),
          makeTask({ id: 5, status: 'in-progress' }),
        ],
      ],
    ]),
  });

  assert.deepEqual(data.tasks.map((t) => t.id), ['5', '3', '2', '4', '1']);
  assert.deepEqual(data.tasks.map((t) => t.isDone), [false, false, false, false, true]);
});

test('a task links to its most relevant session: active outranks idle', () => {
  const data = build({
    projects: [
      makeProject({
        sessions: [
          makeSession({ id: 'idle-newer', taskId: '1', lastActivity: hoursAgo(1) }),
          makeSession({ id: 'running-older', taskId: '1', lastActivity: hoursAgo(10) }),
        ],
      }),
    ],
    running: [{ sessionId: 'running-older' }],
    tasksByProject: new Map([['proj-a', [makeTask({ id: 1 })]]]),
  });

  assert.deepEqual(data.tasks[0].linkedSession, { id: 'running-older', status: 'run' });
});

test('a task link survives even when the linking session aged out of the list', () => {
  const data = build({
    projects: [
      makeProject({ sessions: [makeSession({ id: 'stale-link', taskId: '1', lastActivity: hoursAgo(30) })] }),
    ],
    tasksByProject: new Map([['proj-a', [makeTask({ id: 1 })]]]),
  });

  assert.equal(data.sessions.length, 0);
  assert.deepEqual(data.tasks[0].linkedSession, { id: 'stale-link', status: 'idle' });
});

test('boards expose the four core columns with counts, only for projects with tasks data', () => {
  const data = build({
    projects: [
      makeProject(),
      makeProject({ projectId: 'proj-b', displayName: 'Project B' }),
    ],
    tasksByProject: new Map([
      [
        'proj-a',
        [
          makeTask({ id: 1, status: 'pending' }),
          makeTask({ id: 2, status: 'pending' }),
          makeTask({ id: 3, status: 'done' }),
          makeTask({ id: 4, status: 'deferred' }),
        ],
      ],
    ]),
  });

  assert.equal(data.boards.length, 1);
  const board = data.boards[0];
  assert.equal(board.projectId, 'proj-a');
  assert.deepEqual(board.columns.map((c) => c.status), ['pending', 'in-progress', 'review', 'done']);
  assert.deepEqual(board.columns.map((c) => c.count), [2, 0, 0, 1]);
  // Non-core statuses stay off the overview board.
  assert.equal(board.columns.flatMap((c) => c.tasks).length, 3);
});

test('counts aggregate running and attention sessions with review and done tasks', () => {
  const data = build({
    projects: [
      makeProject({
        sessions: [
          makeSession({ id: 'run-1' }),
          makeSession({ id: 'attn-1' }),
          makeSession({ id: 'idle-1' }),
        ],
      }),
    ],
    running: [
      { sessionId: 'run-1' },
      { sessionId: 'attn-1', needsAttention: true },
    ],
    tasksByProject: new Map([
      [
        'proj-a',
        [
          makeTask({ id: 1, status: 'review' }),
          makeTask({ id: 2, status: 'done' }),
          makeTask({ id: 3, status: 'done' }),
        ],
      ],
    ]),
  });

  assert.deepEqual(data.counts, { running: 1, attn: 1, review: 1, done: 2 });
});
