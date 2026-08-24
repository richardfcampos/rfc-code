import assert from 'node:assert/strict';
import test from 'node:test';

import { executeAutomationAction } from '@/modules/automations/services/automation-actions.service.js';
import { interpolate, payloadVariables, taskVariables } from '@/modules/automations/services/automation-template.js';
import type { AutomationTriggerContext } from '@/modules/automations/automations.types.js';

import { TASK, createFakeDeps } from './support/fake-automation-deps.js';

function taskContext(): AutomationTriggerContext {
  return {
    dedupeKey: null,
    variables: { 'automation.name': 'Pick it up', ...taskVariables(TASK, 'backlog') },
    task: TASK,
  };
}

test('prompt_agent interpolates the template and dispatches through the gateway', async () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      provider: 'codex',
      promptTemplate: 'Work on "{{task}}" ({{task.id}}), moved from {{task.previousStage}}.',
      worktreePath: '/home/dev/my-app-wt',
      worktreeBranch: 'feat/board',
    }),
  });

  const detail = await executeAutomationAction(deps, automation, taskContext());

  assert.equal(deps.prompts.length, 1);
  assert.equal(deps.prompts[0].prompt, 'Work on "Ship the board" (task-1), moved from backlog.');
  assert.equal(deps.prompts[0].provider, 'codex');
  assert.equal(deps.prompts[0].projectPath, '/home/dev/my-app');
  assert.equal(deps.prompts[0].worktreePath, '/home/dev/my-app-wt');
  assert.equal(deps.prompts[0].worktreeBranch, 'feat/board');
  assert.equal(deps.prompts[0].requestedProfileId, null);
  assert.equal(detail, 'Prompted an agent in session session-1 on profile profile-a');
});

test('prompt_agent defaults to claude and forwards a requested profile for the resolver to check', async () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      promptTemplate: 'Do the thing',
      profileId: 'profile-b',
    }),
  });

  await executeAutomationAction(deps, automation, taskContext());

  assert.equal(deps.prompts[0].provider, 'claude');
  assert.equal(deps.prompts[0].requestedProfileId, 'profile-b');
});

test('prompt_agent appends the configured skill as an instruction', async () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      promptTemplate: 'Fix {{task}}',
      skill: 'debug',
    }),
  });

  await executeAutomationAction(deps, automation, taskContext());

  assert.equal(deps.prompts[0].prompt, 'Fix Ship the board\n\nUse the "debug" skill for this work.');
});

test('prompt_agent refuses to spawn a run on an empty prompt', async () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({ projectPath: '/home/dev/my-app', promptTemplate: '{{missing}}' }),
  });

  await assert.rejects(
    () => executeAutomationAction(deps, automation, taskContext()),
    /produced an empty prompt/,
  );
  assert.equal(deps.prompts.length, 0);
});

test('create_task stamps the automation as the origin', async () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    name: 'Nightly review',
    action_kind: 'create_task',
    action_config: JSON.stringify({
      project: 'my-app',
      title: 'Review {{task}}',
      description: 'Follow-up for {{task.id}}',
      suggestedSkill: 'review',
    }),
  });

  const detail = await executeAutomationAction(deps, automation, taskContext());

  assert.deepEqual(deps.createdTasks[0], {
    title: 'Review Ship the board',
    project: 'my-app',
    description: 'Follow-up for task-1',
    origin: 'automation',
    origin_detail: 'Nightly review',
    suggested_skill: 'review',
    assignee_profile_id: undefined,
  });
  assert.equal(detail, 'Created task task-created on my-app');
});

test('create_task refuses an empty title rather than putting a blank card on the board', async () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    action_kind: 'create_task',
    action_config: JSON.stringify({ project: 'my-app', title: '{{nothing}}' }),
  });

  await assert.rejects(() => executeAutomationAction(deps, automation, taskContext()), /empty title/);
  assert.equal(deps.createdTasks.length, 0);
});

test('notify_push sends the interpolated message to the configured recipient', async () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    name: 'Board watcher',
    action_kind: 'notify_push',
    action_config: JSON.stringify({ message: '{{task}} reached {{task.stage}}', userId: 7 }),
  });

  const detail = await executeAutomationAction(deps, automation, taskContext());

  assert.deepEqual(deps.pushes[0], {
    userId: 7,
    message: 'Ship the board reached in_progress',
    automationName: 'Board watcher',
  });
  assert.equal(detail, 'Sent a push notification');
});

test('an action failure propagates so the retry loop can see it', async () => {
  const deps = createFakeDeps({
    tasks: {
      createTask: async () => {
        throw new Error('board unavailable');
      },
    },
  });
  const automation = deps.repository.seed({
    action_kind: 'create_task',
    action_config: JSON.stringify({ project: 'my-app', title: 'Anything' }),
  });

  await assert.rejects(() => executeAutomationAction(deps, automation, taskContext()), /board unavailable/);
});

test('unknown placeholders render as nothing instead of leaking their braces', () => {
  assert.equal(interpolate('a {{ task }} b {{nope}} c', { task: 'X' }), 'a X b  c');
});

test('webhook payloads only expose their scalar top-level fields', () => {
  assert.deepEqual(
    payloadVariables({ ref: 'main', count: 3, ok: true, nested: { a: 1 }, list: [1, 2] }),
    { 'payload.ref': 'main', 'payload.count': '3', 'payload.ok': 'true' },
  );
  assert.deepEqual(payloadVariables('a string'), {});
  assert.deepEqual(payloadVariables(null), {});
});
