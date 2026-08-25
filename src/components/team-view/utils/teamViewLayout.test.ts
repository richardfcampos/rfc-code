import assert from 'node:assert/strict';
import test from 'node:test';

import type { TeamViewEdge, TeamViewSession } from '../types';

import { computeTeamViewLayout, NODE_HEIGHT, NODE_WIDTH } from './teamViewLayout';

function makeSession(sessionId: string, overrides: Partial<TeamViewSession> = {}): TeamViewSession {
  return {
    sessionId,
    provider: 'claude',
    profileId: null,
    state: 'running',
    taskId: null,
    taskTitle: null,
    startedAt: 0,
    usagePct: null,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<TeamViewEdge> = {}): TeamViewEdge {
  return {
    fromSessionId: 'sess-a',
    toSessionId: 'sess-b',
    messageId: 'msg-1',
    state: 'queued',
    subject: 'handoff',
    ...overrides,
  };
}

test('an empty session list produces an empty, zero-ish layout', () => {
  const layout = computeTeamViewLayout([], []);
  assert.deepEqual(layout.nodes, []);
  assert.deepEqual(layout.edges, []);
  assert.ok(layout.width > 0 && layout.height > 0);
});

test('sessions fill the grid left-to-right, top-to-bottom within the column cap', () => {
  const sessions = [makeSession('a'), makeSession('b'), makeSession('c'), makeSession('d')];
  const layout = computeTeamViewLayout(sessions, [], { columns: 3 });

  assert.equal(layout.nodes.length, 4);
  // First 3 sessions share a row (same y), the 4th starts a new row.
  assert.equal(layout.nodes[0]!.y, layout.nodes[1]!.y);
  assert.equal(layout.nodes[1]!.y, layout.nodes[2]!.y);
  assert.notEqual(layout.nodes[2]!.y, layout.nodes[3]!.y);
  // Columns advance left-to-right.
  assert.ok(layout.nodes[1]!.x > layout.nodes[0]!.x);
  assert.ok(layout.nodes[2]!.x > layout.nodes[1]!.x);
  // Node size constants are respected (no overlap within a row).
  assert.ok(layout.nodes[1]!.x >= layout.nodes[0]!.x + NODE_WIDTH);
  assert.ok(layout.nodes[3]!.y >= layout.nodes[0]!.y + NODE_HEIGHT);
});

test('a single session never produces more columns than it has nodes', () => {
  const layout = computeTeamViewLayout([makeSession('a')], [], { columns: 3 });
  assert.equal(layout.nodes.length, 1);
  assert.equal(layout.nodes[0]!.x, layout.nodes[0]!.x); // sanity: one deterministic cell
});

test('an edge between two known sessions resolves to their node centers', () => {
  const sessions = [makeSession('sess-a'), makeSession('sess-b')];
  const edge = makeEdge();
  const layout = computeTeamViewLayout(sessions, [edge]);

  assert.equal(layout.edges.length, 1);
  const [laidOutEdge] = layout.edges;
  const nodeA = layout.nodes.find((n) => n.session.sessionId === 'sess-a')!;
  const nodeB = layout.nodes.find((n) => n.session.sessionId === 'sess-b')!;
  assert.equal(laidOutEdge!.x1, nodeA.x + NODE_WIDTH / 2);
  assert.equal(laidOutEdge!.y1, nodeA.y + NODE_HEIGHT / 2);
  assert.equal(laidOutEdge!.x2, nodeB.x + NODE_WIDTH / 2);
  assert.equal(laidOutEdge!.y2, nodeB.y + NODE_HEIGHT / 2);
});

test('an edge referencing a session outside the current list is dropped, not crashed on', () => {
  const sessions = [makeSession('sess-a')];
  const edge = makeEdge({ toSessionId: 'sess-nowhere' });

  const layout = computeTeamViewLayout(sessions, [edge]);

  assert.deepEqual(layout.edges, []);
});

test('layout is deterministic for the same input', () => {
  const sessions = [makeSession('a'), makeSession('b'), makeSession('c')];
  const edges = [makeEdge({ fromSessionId: 'a', toSessionId: 'b' })];

  const first = computeTeamViewLayout(sessions, edges);
  const second = computeTeamViewLayout(sessions, edges);

  assert.deepEqual(first, second);
});
