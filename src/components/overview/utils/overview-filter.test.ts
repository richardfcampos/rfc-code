import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverviewSession, OverviewTask } from './overview-data';
import {
  filterOverviewSessions,
  filterOverviewTasks,
  litBoardColumns,
  parseOverviewFilterParam,
  serializeOverviewFilterParam,
  type OverviewFilterId,
} from './overview-filter';

const makeSession = (overrides: Partial<OverviewSession> = {}): OverviewSession => ({
  id: 'session-1',
  projectId: 'proj-a',
  projectName: 'Project A',
  accent: { hue: 'hsl(217 91% 66%)' },
  provider: 'claude',
  title: 'Fix the flaky test',
  worktreeLabel: null,
  status: 'idle',
  statusText: null,
  lastActivity: '2026-08-30T11:00:00.000Z',
  taskRef: null,
  ...overrides,
});

const makeTask = (overrides: Partial<OverviewTask> = {}): OverviewTask => ({
  projectId: 'proj-a',
  projectName: 'Project A',
  accent: { hue: 'hsl(217 91% 66%)' },
  id: '1',
  title: 'Build the thing',
  status: 'pending',
  isDone: false,
  linkedSession: null,
  ...overrides,
});

const filters = (...ids: OverviewFilterId[]) => new Set(ids);

test('an empty filter set keeps every session', () => {
  const sessions = [
    makeSession({ id: 'a', status: 'run' }),
    makeSession({ id: 'b', status: 'attn' }),
    makeSession({ id: 'c', status: 'idle' }),
  ];

  assert.deepEqual(filterOverviewSessions(sessions, filters()).map((s) => s.id), ['a', 'b', 'c']);
});

test('session filters match by status: run, attn, and done as idle', () => {
  const sessions = [
    makeSession({ id: 'running', status: 'run' }),
    makeSession({ id: 'blocked', status: 'attn' }),
    makeSession({ id: 'finished', status: 'idle' }),
  ];

  assert.deepEqual(filterOverviewSessions(sessions, filters('run')).map((s) => s.id), ['running']);
  assert.deepEqual(filterOverviewSessions(sessions, filters('attn')).map((s) => s.id), ['blocked']);
  assert.deepEqual(filterOverviewSessions(sessions, filters('done')).map((s) => s.id), ['finished']);
});

test('the review filter matches sessions whose linked task is in review', () => {
  const sessions = [
    makeSession({ id: 'reviewing', status: 'run', taskRef: { id: '1', title: 'T', status: 'review' } }),
    makeSession({ id: 'building', status: 'run', taskRef: { id: '2', title: 'T', status: 'in-progress' } }),
    makeSession({ id: 'unlinked', status: 'run' }),
  ];

  assert.deepEqual(filterOverviewSessions(sessions, filters('review')).map((s) => s.id), ['reviewing']);
});

test('multiple active filters union their session matches', () => {
  const sessions = [
    makeSession({ id: 'running', status: 'run' }),
    makeSession({ id: 'blocked', status: 'attn' }),
    makeSession({ id: 'finished', status: 'idle' }),
  ];

  assert.deepEqual(
    filterOverviewSessions(sessions, filters('run', 'done')).map((s) => s.id),
    ['running', 'finished'],
  );
});

test('an empty filter set keeps every task except done ones', () => {
  const tasks = [
    makeTask({ id: '1', status: 'in-progress' }),
    makeTask({ id: '2', status: 'pending' }),
    makeTask({ id: '3', status: 'done', isDone: true }),
  ];

  assert.deepEqual(filterOverviewTasks(tasks, filters()).map((t) => t.id), ['1', '2']);
});

test('task filters map run to in-progress, attn and review to review, done to done', () => {
  const tasks = [
    makeTask({ id: '1', status: 'in-progress' }),
    makeTask({ id: '2', status: 'review' }),
    makeTask({ id: '3', status: 'pending' }),
    makeTask({ id: '4', status: 'done', isDone: true }),
  ];

  assert.deepEqual(filterOverviewTasks(tasks, filters('run')).map((t) => t.id), ['1']);
  assert.deepEqual(filterOverviewTasks(tasks, filters('attn')).map((t) => t.id), ['2']);
  assert.deepEqual(filterOverviewTasks(tasks, filters('review')).map((t) => t.id), ['2']);
  assert.deepEqual(filterOverviewTasks(tasks, filters('done')).map((t) => t.id), ['4']);
  assert.deepEqual(filterOverviewTasks(tasks, filters('run', 'done')).map((t) => t.id), ['1', '4']);
});

test('board columns all stay lit with no filter and dim to the union otherwise', () => {
  assert.equal(litBoardColumns(filters()), null);
  assert.deepEqual(litBoardColumns(filters('run')), new Set(['in-progress']));
  assert.deepEqual(litBoardColumns(filters('attn', 'review')), new Set(['review']));
  assert.deepEqual(litBoardColumns(filters('run', 'done')), new Set(['in-progress', 'done']));
});

test('the filter query param round-trips and unknown values are ignored', () => {
  assert.deepEqual(parseOverviewFilterParam('run,attn'), new Set(['run', 'attn']));
  assert.deepEqual(parseOverviewFilterParam('run,bogus,'), new Set(['run']));
  assert.deepEqual(parseOverviewFilterParam(null), new Set());
  assert.equal(serializeOverviewFilterParam(new Set(['done', 'run'])), 'run,done');
  assert.equal(serializeOverviewFilterParam(new Set()), '');
});
