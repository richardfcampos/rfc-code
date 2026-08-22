import assert from 'node:assert/strict';
import test from 'node:test';

import { runAgentBridgeTool } from '@/modules/agent-bridge/agent-bridge.tools.js';
import type { TaskRow } from '@/modules/database/index.js';
import { OrgPolicyError } from '@/modules/orgs/index.js';
import { AppError } from '@/shared/utils.js';

import { createBridgeDeps, SCOPE, TASK } from './support/fake-bridge-deps.js';

async function expectAppError(
  run: () => Promise<unknown>,
  expected: { code: string; statusCode: number },
): Promise<AppError> {
  const error = await run().then(
    () => null,
    (thrown: unknown) => thrown,
  );

  assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
  assert.equal(error.code, expected.code);
  assert.equal(error.statusCode, expected.statusCode);
  return error;
}

test('task_create stores the session scope, marks the origin and broadcasts', async () => {
  const deps = createBridgeDeps();

  const result = await runAgentBridgeTool(
    'task_create',
    { title: '  Wire the bridge  ', description: 'with tests', suggested_skill: 'backend' },
    SCOPE,
    deps,
  ) as { task: TaskRow };

  assert.equal(result.task.title, 'Wire the bridge');
  assert.deepEqual(deps.createCalls[0], {
    title: 'Wire the bridge',
    project: SCOPE.projectName,
    description: 'with tests',
    suggested_skill: 'backend',
    origin: 'agent',
    origin_detail: SCOPE.sessionId,
  });
  assert.deepEqual(deps.broadcasts.map(([, action]) => action), ['created']);
});

test('task_create rejects a missing title before touching the service', async () => {
  const deps = createBridgeDeps();

  await expectAppError(() => runAgentBridgeTool('task_create', {}, SCOPE, deps), {
    code: 'AGENT_BRIDGE_VALIDATION_ERROR',
    statusCode: 400,
  });
  assert.equal(deps.createCalls.length, 0);
});

test('task_list returns the project tasks and filters by stage', async () => {
  const deps = createBridgeDeps();

  const all = await runAgentBridgeTool('task_list', {}, SCOPE, deps) as { tasks: TaskRow[] };
  assert.deepEqual(all.tasks.map((task) => task.id), [TASK.id]);

  const done = await runAgentBridgeTool('task_list', { stage: 'done' }, SCOPE, deps) as { tasks: TaskRow[] };
  assert.deepEqual(done.tasks, []);

  await expectAppError(() => runAgentBridgeTool('task_list', { stage: 'shipped' }, SCOPE, deps), {
    code: 'AGENT_BRIDGE_VALIDATION_ERROR',
    statusCode: 400,
  });
});

test('task_update_stage moves a task of this project and broadcasts', async () => {
  const deps = createBridgeDeps();

  const result = await runAgentBridgeTool(
    'task_update_stage',
    { taskId: TASK.id, stage: 'in_progress' },
    SCOPE,
    deps,
  ) as { task: TaskRow };

  assert.equal(result.task.stage, 'in_progress');
  assert.deepEqual(deps.updateCalls, [[TASK.id, { stage: 'in_progress' }]]);
  assert.deepEqual(deps.broadcasts.map(([, action]) => action), ['updated']);
});

test('task_update_stage refuses a task outside the session project', async () => {
  const deps = createBridgeDeps();

  await expectAppError(
    () => runAgentBridgeTool('task_update_stage', { taskId: 'other-project-task', stage: 'done' }, SCOPE, deps),
    { code: 'AGENT_BRIDGE_TASK_NOT_FOUND', statusCode: 404 },
  );
  assert.equal(deps.updateCalls.length, 0);
  assert.equal(deps.broadcasts.length, 0);
});

test('task_assign sets the assignee once policy allows it', async () => {
  const checked: Array<[string | null, string]> = [];
  const deps = createBridgeDeps({
    policy: {
      assertProfileAllowed: (projectPath, profileId) => {
        checked.push([projectPath, profileId]);
      },
    },
  });

  await runAgentBridgeTool('task_assign', { taskId: TASK.id, profileId: 'profile-1' }, SCOPE, deps);

  assert.deepEqual(checked, [[SCOPE.projectPath, 'profile-1']]);
  assert.deepEqual(deps.updateCalls, [[TASK.id, { assignee_profile_id: 'profile-1' }]]);
  assert.deepEqual(deps.broadcasts.map(([, action]) => action), ['updated']);
});

test('task_assign denied by policy keeps the reason and updates nothing', async () => {
  const deps = createBridgeDeps({
    policy: {
      assertProfileAllowed: () => {
        throw new OrgPolicyError('Profile "profile-9" is not allowed for this project.');
      },
    },
  });

  const error = await expectAppError(
    () => runAgentBridgeTool('task_assign', { taskId: TASK.id, profileId: 'profile-9' }, SCOPE, deps),
    { code: 'ORG_POLICY_DENIED', statusCode: 403 },
  );

  assert.match(error.message, /not allowed for this project/);
  assert.equal(deps.updateCalls.length, 0);
  assert.equal(deps.broadcasts.length, 0);
});

test('profile_recommend forwards the project path and an optional provider', async () => {
  const calls: Array<[string | null, string | undefined]> = [];
  const deps = createBridgeDeps({
    recommend: {
      recommend: async (projectPath, provider) => {
        calls.push([projectPath, provider]);
        return { profileId: 'profile-2', role: 'fallback', usagePct: 91, reason: 'primary over quota' };
      },
    },
  });

  const result = await runAgentBridgeTool('profile_recommend', { provider: 'codex' }, SCOPE, deps) as {
    recommendation: { profileId: string; role: string };
  };

  assert.equal(result.recommendation.profileId, 'profile-2');
  assert.deepEqual(calls, [[SCOPE.projectPath, 'codex']]);

  await runAgentBridgeTool('profile_recommend', {}, SCOPE, deps);
  assert.deepEqual(calls[1], [SCOPE.projectPath, undefined]);

  await expectAppError(() => runAgentBridgeTool('profile_recommend', { provider: 'gemini' }, SCOPE, deps), {
    code: 'AGENT_BRIDGE_VALIDATION_ERROR',
    statusCode: 400,
  });
});

test('an unknown tool is a 404', async () => {
  const deps = createBridgeDeps();

  await expectAppError(() => runAgentBridgeTool('task_delete_everything', {}, SCOPE, deps), {
    code: 'AGENT_BRIDGE_UNKNOWN_TOOL',
    statusCode: 404,
  });
});
