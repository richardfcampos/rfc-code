/**
 * Dispatch tests for the maestro tools.
 *
 * The wiring these cover is what a leader session cannot check for itself: the
 * project comes from the token, a profile is either policy-approved or picked
 * by the recommender, blocked work is refused, and a delegation always leaves
 * both an assignment and a trail behind.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { TaskDelegation } from '@/modules/agent-bridge/agent-bridge.maestro.tools.js';
import { runAgentBridgeTool } from '@/modules/agent-bridge/agent-bridge.tools.js';
import type { SubtaskRow } from '@/modules/database/index.js';
import type { TaskDecomposition } from '@/modules/tasks/index.js';
import { AppError } from '@/shared/utils.js';

import { createBridgeDeps, DECOMPOSITION, SCOPE, SUBTASKS, TASK } from './support/fake-bridge-deps.js';

test('task_decompose plans under a parent on the caller\'s own board', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'task_decompose',
    {
      parentTaskId: TASK.id,
      subtasks: [{ title: 'Parse the CSV' }, { title: 'Write the loader', dependsOn: [0] }],
    },
    SCOPE,
    deps,
  )) as TaskDecomposition;

  assert.equal(result.subtasks.length, 2);
  const [parentTaskId, body] = deps.decomposeCalls[0]!;
  assert.equal(parentTaskId, TASK.id);
  // The leader's session id is stamped on the plan, not taken from the request.
  assert.equal(body.origin_detail, SCOPE.sessionId);
  assert.ok(Array.isArray(body.subtasks));
});

test('task_decompose announces every new card and the parent', async () => {
  const deps = createBridgeDeps();

  await runAgentBridgeTool(
    'task_decompose',
    { parentTaskId: TASK.id, subtasks: [{ title: 'Parse the CSV' }] },
    SCOPE,
    deps,
  );

  assert.deepEqual(
    deps.broadcasts.map(([task, action]) => [task.id, action]),
    [
      [SUBTASKS[0]!.id, 'created'],
      [SUBTASKS[1]!.id, 'created'],
      [DECOMPOSITION.parent.id, 'updated'],
    ],
  );
});

test('task_decompose refuses a parent from another project as not found', async () => {
  const deps = createBridgeDeps();

  const error = await runAgentBridgeTool(
    'task_decompose',
    { parentTaskId: 'task-from-another-board', subtasks: [{ title: 'Anything' }] },
    SCOPE,
    deps,
  ).then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_BRIDGE_TASK_NOT_FOUND');
  assert.equal(error.statusCode, 404);
  assert.equal(deps.decomposeCalls.length, 0);
});

test('task_decompose requires a parent id before calling the service', async () => {
  const deps = createBridgeDeps();

  const error = await runAgentBridgeTool('task_decompose', { subtasks: [] }, SCOPE, deps).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_BRIDGE_VALIDATION_ERROR');
  assert.equal(deps.decomposeCalls.length, 0);
});

test('task_decompose lets the tasks module reject an invalid plan', async () => {
  const deps = createBridgeDeps({
    decomposition: {
      decompose: () => {
        throw new AppError('subtasks form a dependency cycle (indices: 0, 1)', {
          code: 'TASK_VALIDATION_ERROR',
          statusCode: 400,
        });
      },
      getDecomposition: () => DECOMPOSITION,
      listReady: () => [],
      listBlockers: () => [],
    },
  });

  const error = await runAgentBridgeTool(
    'task_decompose',
    { parentTaskId: TASK.id, subtasks: [{ title: 'A', dependsOn: [1] }, { title: 'B', dependsOn: [0] }] },
    SCOPE,
    deps,
  ).then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'TASK_VALIDATION_ERROR');
  assert.equal(deps.broadcasts.length, 0);
});

test('task_ready_list answers only the startable subtasks', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'task_ready_list',
    { parentTaskId: TASK.id },
    SCOPE,
    deps,
  )) as { parentTaskId: string; subtasks: SubtaskRow[] };

  assert.equal(result.parentTaskId, TASK.id);
  assert.deepEqual(result.subtasks.map((task) => task.id), [SUBTASKS[0]!.id]);
});

test('task_delegate assigns the named profile after the policy allows it, and hands off', async () => {
  const allowed: Array<[string | null, string]> = [];
  const deps = createBridgeDeps({
    policy: {
      assertProfileAllowed: (projectPath, profileId) => {
        allowed.push([projectPath, profileId]);
      },
    },
  });

  const result = (await runAgentBridgeTool(
    'task_delegate',
    { taskId: TASK.id, toSessionId: 'session-2', profileId: 'profile-9' },
    SCOPE,
    deps,
  )) as TaskDelegation;

  assert.deepEqual(allowed, [[SCOPE.projectPath, 'profile-9']]);
  assert.deepEqual(deps.updateCalls, [[TASK.id, { assignee_profile_id: 'profile-9' }]]);
  assert.equal(result.recommendation, null);

  assert.ok(result.message);
  assert.equal(result.message.from_session_id, SCOPE.sessionId);
  assert.equal(result.message.to_session_id, 'session-2');
  assert.match(result.message.subject, /Task assigned/);
  assert.match(result.message.body, new RegExp(TASK.id));
});

test('a profile the org policy denies stops the delegation before anything is written', async () => {
  const deps = createBridgeDeps({
    policy: {
      assertProfileAllowed: () => {
        throw new AppError('Profile "profile-9" is not allowed for this project.', {
          code: 'ORG_POLICY_DENIED',
          statusCode: 403,
        });
      },
    },
  });

  const error = await runAgentBridgeTool(
    'task_delegate',
    { taskId: TASK.id, toSessionId: 'session-2', profileId: 'profile-9' },
    SCOPE,
    deps,
  ).then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'ORG_POLICY_DENIED');
  assert.equal(error.statusCode, 403);
  assert.equal(deps.updateCalls.length, 0);
  assert.equal(deps.evidenceCalls.length, 0);
  assert.equal(deps.messageCalls.send.length, 0);
  assert.equal(deps.broadcasts.length, 0);
});

test('an omitted profile is filled in by the quota-aware recommender and recorded', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'task_delegate',
    { taskId: TASK.id, toSessionId: 'session-2' },
    SCOPE,
    deps,
  )) as TaskDelegation;

  assert.equal(result.recommendation?.profileId, 'profile-1');
  assert.deepEqual(deps.updateCalls, [[TASK.id, { assignee_profile_id: 'profile-1' }]]);

  const [taskId, evidence] = deps.evidenceCalls[0]!;
  assert.equal(taskId, TASK.id);
  assert.equal(evidence.kind, 'note');
  assert.match(String(evidence.content), /session-2/);
  assert.match(String(evidence.content), /profile-1/);
  // The reason the recommender gave is part of the trail, not just the id.
  assert.match(String(evidence.content), /primary account below threshold/);
});

test('delegating without a recipient assigns the task and sends nothing', async () => {
  const deps = createBridgeDeps();

  const result = (await runAgentBridgeTool(
    'task_delegate',
    { taskId: TASK.id, profileId: 'profile-9' },
    SCOPE,
    deps,
  )) as TaskDelegation;

  assert.equal(result.message, null);
  assert.equal(deps.messageCalls.send.length, 0);
  assert.equal(deps.updateCalls.length, 1);
  assert.match(String(deps.evidenceCalls[0]![1].content), /no recipient session/);
});

test('a task whose blockers are still open is not delegable', async () => {
  const deps = createBridgeDeps({
    decomposition: {
      decompose: () => DECOMPOSITION,
      getDecomposition: () => DECOMPOSITION,
      listReady: () => [],
      listBlockers: () => [SUBTASKS[0]!],
    },
  });

  const error = await runAgentBridgeTool(
    'task_delegate',
    { taskId: TASK.id, toSessionId: 'session-2', profileId: 'profile-9' },
    SCOPE,
    deps,
  ).then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_BRIDGE_VALIDATION_ERROR');
  assert.match(error.message, /still waits on: Parse the CSV/);
  assert.equal(deps.updateCalls.length, 0);
  assert.equal(deps.messageCalls.send.length, 0);
});

test('task_delegate refuses a task outside the token\'s project', async () => {
  const deps = createBridgeDeps();

  const error = await runAgentBridgeTool(
    'task_delegate',
    { taskId: 'task-from-another-board', profileId: 'profile-9' },
    SCOPE,
    deps,
  ).then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_BRIDGE_TASK_NOT_FOUND');
  assert.equal(deps.updateCalls.length, 0);
});

test('a dead recipient leaves the assignment standing and names the reason', async () => {
  const deps = createBridgeDeps({
    messages: {
      send: () => {
        throw new AppError('Session "session-2" is not a live session.', {
          code: 'AGENT_MESSAGE_RECIPIENT_UNKNOWN',
          statusCode: 404,
        });
      },
      list: () => [],
      pullInbox: () => [],
      acknowledge: () => {
        throw new Error('Unexpected acknowledge call');
      },
      answer: () => {
        throw new Error('Unexpected answer call');
      },
    },
  });

  const error = await runAgentBridgeTool(
    'task_delegate',
    { taskId: TASK.id, toSessionId: 'session-2', profileId: 'profile-9' },
    SCOPE,
    deps,
  ).then(() => null, (thrown: unknown) => thrown);

  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AGENT_MESSAGE_RECIPIENT_UNKNOWN');
  // The assignment is not rolled back: re-delegating to another worker is the
  // recovery, and it needs the board to already say who owns the task.
  assert.equal(deps.updateCalls.length, 1);
  assert.equal(deps.evidenceCalls.length, 1);
});
