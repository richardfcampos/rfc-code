import assert from 'node:assert/strict';
import test from 'node:test';

import { createTeamViewService } from '@/modules/team-view/team-view.service.js';

import { createFakeDeps, makeMessage } from './support/fake-team-view-deps.js';

test('getSnapshot lists every running session as a node, state always running', async () => {
  const { deps } = createFakeDeps({
    running: [
      { sessionId: 'sess-a', provider: 'claude', startedAt: 100 },
      { sessionId: 'sess-b', provider: 'codex', startedAt: 200 },
    ],
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.equal(snapshot.sessions.length, 2);
  assert.deepEqual(
    snapshot.sessions.map((s) => [s.sessionId, s.provider, s.state, s.startedAt]),
    [
      ['sess-a', 'claude', 'running', 100],
      ['sess-b', 'codex', 'running', 200],
    ],
  );
});

test('a session with no profile gets no task and no usage', async () => {
  const { deps, usageCalls } = createFakeDeps({
    running: [{ sessionId: 'sess-a', provider: 'claude', startedAt: 1 }],
    sessions: { 'sess-a': { projectPath: '/repo/a', profileId: null } },
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.equal(snapshot.sessions[0]!.taskId, null);
  assert.equal(snapshot.sessions[0]!.taskTitle, null);
  assert.equal(snapshot.sessions[0]!.usagePct, null);
  assert.deepEqual(usageCalls, []);
});

test('a session picks the most recently updated in-progress task assigned to its profile', async () => {
  const { deps } = createFakeDeps({
    running: [{ sessionId: 'sess-a', provider: 'claude', startedAt: 1 }],
    sessions: { 'sess-a': { projectPath: '/repo/a', profileId: 'profile-1' } },
    projects: { '/repo/a': 'project-1' },
    tasksByProject: {
      'project-1': [
        {
          id: 'task-older',
          title: 'Older task',
          assigneeProfileId: 'profile-1',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'task-other-profile',
          title: 'Not this profile',
          assigneeProfileId: 'profile-2',
          updatedAt: '2026-01-03T00:00:00.000Z',
        },
        {
          id: 'task-newer',
          title: 'Newer task',
          assigneeProfileId: 'profile-1',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    },
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.equal(snapshot.sessions[0]!.taskId, 'task-newer');
  assert.equal(snapshot.sessions[0]!.taskTitle, 'Newer task');
});

test('an unresolvable project path leaves the task unset instead of throwing', async () => {
  const { deps } = createFakeDeps({
    running: [{ sessionId: 'sess-a', provider: 'claude', startedAt: 1 }],
    sessions: { 'sess-a': { projectPath: '/repo/unknown', profileId: 'profile-1' } },
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.equal(snapshot.sessions[0]!.taskId, null);
});

test('usage is fetched once per distinct profile even across multiple sessions', async () => {
  const { deps, usageCalls } = createFakeDeps({
    running: [
      { sessionId: 'sess-a', provider: 'claude', startedAt: 1 },
      { sessionId: 'sess-b', provider: 'claude', startedAt: 2 },
    ],
    sessions: {
      'sess-a': { projectPath: null, profileId: 'profile-1' },
      'sess-b': { projectPath: null, profileId: 'profile-1' },
    },
    usage: { 'profile-1': 42 },
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.deepEqual(usageCalls, ['profile-1']);
  assert.equal(snapshot.sessions[0]!.usagePct, 42);
  assert.equal(snapshot.sessions[1]!.usagePct, 42);
});

test('a usage fetch failure resolves to null instead of failing the snapshot', async () => {
  const { deps } = createFakeDeps({
    running: [{ sessionId: 'sess-a', provider: 'claude', startedAt: 1 }],
    sessions: { 'sess-a': { projectPath: null, profileId: 'profile-1' } },
    usage: { 'profile-1': new Error('rate limited') },
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.equal(snapshot.sessions[0]!.usagePct, null);
});

test('an edge is included only when both endpoints are currently running sessions', async () => {
  const { deps } = createFakeDeps({
    running: [
      { sessionId: 'sess-a', provider: 'claude', startedAt: 1 },
      { sessionId: 'sess-b', provider: 'claude', startedAt: 2 },
    ],
    messagesBySession: {
      'sess-a': [
        makeMessage('msg-1', 'sess-a', 'sess-b', { state: 'delivered', subject: 'Review this' }),
        makeMessage('msg-2', 'sess-a', 'sess-gone', { subject: 'To a finished session' }),
      ],
      'sess-b': [makeMessage('msg-1', 'sess-a', 'sess-b', { state: 'delivered', subject: 'Review this' })],
    },
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.deepEqual(snapshot.edges, [
    { fromSessionId: 'sess-a', toSessionId: 'sess-b', messageId: 'msg-1', state: 'delivered', subject: 'Review this' },
  ]);
});

test('a message seen from both endpoints is de-duplicated to one edge', async () => {
  const { deps } = createFakeDeps({
    running: [
      { sessionId: 'sess-a', provider: 'claude', startedAt: 1 },
      { sessionId: 'sess-b', provider: 'claude', startedAt: 2 },
    ],
    messagesBySession: {
      'sess-a': [makeMessage('msg-1', 'sess-a', 'sess-b')],
      'sess-b': [makeMessage('msg-1', 'sess-a', 'sess-b')],
    },
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.equal(snapshot.edges.length, 1);
});

test('edges come back sorted by message id for a stable comparison across polls', async () => {
  const { deps } = createFakeDeps({
    running: [
      { sessionId: 'sess-a', provider: 'claude', startedAt: 1 },
      { sessionId: 'sess-b', provider: 'claude', startedAt: 2 },
    ],
    messagesBySession: {
      'sess-a': [
        makeMessage('msg-z', 'sess-a', 'sess-b'),
        makeMessage('msg-a', 'sess-b', 'sess-a'),
      ],
      'sess-b': [
        makeMessage('msg-z', 'sess-a', 'sess-b'),
        makeMessage('msg-a', 'sess-b', 'sess-a'),
      ],
    },
  });

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.deepEqual(snapshot.edges.map((edge) => edge.messageId), ['msg-a', 'msg-z']);
});

test('no running sessions yields an empty snapshot, not an error', async () => {
  const { deps } = createFakeDeps();

  const snapshot = await createTeamViewService(deps).getSnapshot();

  assert.deepEqual(snapshot, { sessions: [], edges: [] });
});
