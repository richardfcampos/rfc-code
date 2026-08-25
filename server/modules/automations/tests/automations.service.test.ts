import assert from 'node:assert/strict';
import test from 'node:test';

import { AutomationNotFoundError } from '@/modules/automations/automations.errors.js';
import { MAX_ATTEMPTS, createAutomationFiringService, toAutomationView } from '@/modules/automations/automations.service.js';
import { taskVariables } from '@/modules/automations/services/automation-template.js';
import type { AutomationTriggerContext } from '@/modules/automations/automations.types.js';
import type { TaskRow } from '@/modules/database/index.js';

import { TASK, createFakeDeps } from './support/fake-automation-deps.js';

const EVENT: AutomationTriggerContext = {
  dedupeKey: 'task:task-1:stage:in_progress',
  variables: { task: 'Ship the board' },
};

const UNIDENTIFIED_EVENT: AutomationTriggerContext = { dedupeKey: null, variables: {} };

test('a successful firing records one attempt and reports its detail', async () => {
  const deps = createFakeDeps();
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();

  const result = await service.fire(automation, EVENT);

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 1);
  assert.equal(deps.pushes.length, 1);
  assert.equal(deps.pushes[0].message, 'Moved: Ship the board');

  assert.equal(deps.repository.history.length, 1);
  assert.equal(deps.repository.history[0].status, 'success');
  assert.equal(deps.repository.history[0].dedupe_key, EVENT.dedupeKey);
});

test('the same event never executes an automation twice', async () => {
  const deps = createFakeDeps();
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();

  await service.fire(automation, EVENT);
  const second = await service.fire(automation, EVENT);

  assert.equal(second.status, 'skipped');
  assert.equal(second.detail, 'Already fired for this event');
  assert.equal(second.attempts, 0);
  // A skip is not an execution, so nothing new happened and nothing was appended.
  assert.equal(deps.pushes.length, 1);
  assert.equal(deps.repository.history.length, 1);
});

test('a firing that exhausted its retries still blocks the same event later', async () => {
  const deps = createFakeDeps({
    notify: {
      push: () => {
        throw new Error('push channel down');
      },
    },
  });
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();

  await service.fire(automation, EVENT);
  const second = await service.fire(automation, EVENT);

  assert.equal(second.status, 'skipped');
  assert.equal(deps.repository.history.length, MAX_ATTEMPTS);
});

test('two observations of one event racing each other execute once', async () => {
  const deps = createFakeDeps();
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();

  const [first, second] = await Promise.all([service.fire(automation, EVENT), service.fire(automation, EVENT)]);

  const outcomes = [first.status, second.status].sort();
  assert.deepEqual(outcomes, ['skipped', 'success']);
  assert.equal(deps.pushes.length, 1);
});

test('an event with no identity always fires', async () => {
  const deps = createFakeDeps();
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();

  await service.fire(automation, UNIDENTIFIED_EVENT);
  await service.fire(automation, UNIDENTIFIED_EVENT);

  assert.equal(deps.pushes.length, 2);
  assert.equal(deps.repository.history.length, 2);
});

test('a failing action is retried with a growing pause, bounded at three attempts', async () => {
  let calls = 0;
  const deps = createFakeDeps({
    notify: {
      push: () => {
        calls += 1;
        throw new Error('push channel down');
      },
    },
  });
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();

  const result = await service.fire(automation, EVENT);

  assert.equal(calls, MAX_ATTEMPTS);
  assert.equal(result.status, 'failed');
  assert.equal(result.attempts, MAX_ATTEMPTS);
  assert.equal(result.detail, 'push channel down');
  // Pauses happen between attempts, never after the last one.
  assert.deepEqual(deps.sleeps, [1_000, 3_000]);
});

test('every attempt is recorded, so a retry sequence is readable in the history', async () => {
  let calls = 0;
  const deps = createFakeDeps({
    notify: {
      push: () => {
        calls += 1;
        if (calls < 3) throw new Error(`attempt ${calls} failed`);
      },
    },
  });
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();

  const result = await service.fire(automation, EVENT);

  assert.equal(result.status, 'success');
  assert.equal(result.attempts, 3);
  assert.deepEqual(
    deps.repository.history.map((run) => [run.attempt, run.status, run.detail]),
    [
      [1, 'failed', 'attempt 1 failed'],
      [2, 'failed', 'attempt 2 failed'],
      [3, 'success', 'Sent a push notification'],
    ],
  );
});

test('a history write that loses its race is dropped, not turned into a failure', async () => {
  const deps = createFakeDeps();
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();
  // The winner of the race already wrote attempt 1 for this event.
  deps.repository.runs.record({
    automationId: automation.automation_id,
    status: 'success',
    attempt: 1,
    dedupeKey: 'other-writer',
  });
  deps.repository.history[0].dedupe_key = EVENT.dedupeKey;

  const result = await service.fire(automation, { ...EVENT, dedupeKey: null });

  assert.equal(result.status, 'success');
  assert.equal(deps.pushes.length, 1);
});

test('long failure messages are truncated before they reach the history', async () => {
  const deps = createFakeDeps({
    notify: {
      push: () => {
        throw new Error('x'.repeat(2_000));
      },
    },
  });
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();

  const result = await service.fire(automation, EVENT);

  assert.equal(result.detail.length, 500);
  assert.ok(result.detail.endsWith('…'));
});

test('an unrecorded skip leaves no run row, so the same once-ever dedupe key can fire again later', async () => {
  // A `task_stage` dedupe key is the same string every time a task re-enters
  // that stage — reused here across two firings to prove the first one (the
  // author's own live run still owning the branch) did not burn it. Without
  // this, the second firing (the branch free again) would be blocked by a
  // "success" row that was never an actual review.
  let branchIsLive = true;
  const spawnedPrompts: unknown[] = [];
  const deps = createFakeDeps({
    agent: {
      promptAgent: async (input) => {
        spawnedPrompts.push(input);
        return { sessionId: 'session-1', profileId: 'profile-a' };
      },
      hasLiveSessionForBranch: () => branchIsLive,
    },
  });
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed({
    trigger_kind: 'task_stage',
    trigger_config: JSON.stringify({ toStage: 'review' }),
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      promptTemplate: 'Review {{task.id}}.',
      useTaskWorktree: true,
    }),
  });
  const task: TaskRow = { ...TASK, worktree_branch: 'auto/task-1', stage: 'review' };
  const context: AutomationTriggerContext = {
    dedupeKey: `task:${task.id}:stage:review`,
    variables: taskVariables(task, 'in_progress'),
    task,
  };

  const first = await service.fire(automation, context);
  assert.equal(first.status, 'skipped');
  assert.match(first.detail, /already has a live agent session/);
  assert.equal(first.attempts, 1);
  assert.equal(deps.repository.history.length, 0, 'an unrecorded skip must append no run row');
  assert.equal(spawnedPrompts.length, 0);

  // The reviewer's own run has since ended, freeing the branch; the task's
  // next entry into review carries the identical dedupe key.
  branchIsLive = false;
  const second = await service.fire(automation, context);

  assert.equal(second.status, 'success');
  assert.equal(deps.repository.history.length, 1);
  assert.equal(spawnedPrompts.length, 1);
});

test('an integration skip on a live branch is unrecorded too, not just the useTaskWorktree pickup path', async () => {
  let branchIsLive = true;
  const deps = createFakeDeps({
    agent: {
      promptAgent: async () => ({ sessionId: 'session-1', profileId: 'profile-a' }),
      hasLiveSessionForBranch: () => branchIsLive,
    },
  });
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app' }),
    action_kind: 'pickup_task',
    action_config: JSON.stringify({ projectPath: '/home/dev/my-app' }),
  });
  const parent = deps.board.seed({
    stage: 'in_progress',
    title: 'Ship the board',
    worktree_branch: 'auto/task-parent-1',
  });
  deps.board.seed({ stage: 'done', title: 'Schema', worktree_branch: 'auto/task-child-1', parentTaskId: parent.id });

  const context: AutomationTriggerContext = {
    dedupeKey: `integrate:${parent.id}:1:child-updated`,
    variables: {},
    task: parent,
    intent: 'integrate',
  };

  const first = await service.fire(automation, context);
  assert.equal(first.status, 'skipped');
  assert.match(first.detail, /already has a live agent session/);
  assert.equal(deps.repository.history.length, 0, 'an unrecorded skip must append no run row');

  branchIsLive = false;
  const second = await service.fire(automation, context);

  assert.equal(second.status, 'success');
  assert.equal(deps.repository.history.length, 1);
});

test('history and lookups are scoped to one automation', async () => {
  const deps = createFakeDeps();
  const service = createAutomationFiringService(deps);
  const automation = deps.repository.seed();
  const other = deps.repository.seed();

  await service.fire(automation, EVENT);
  await service.fire(other, EVENT);

  assert.equal(service.listHistory(automation.automation_id).length, 1);
  assert.equal(service.listHistory(other.automation_id).length, 1);
  assert.equal(service.requireAutomation(automation.automation_id).automation_id, automation.automation_id);
  assert.throws(() => service.requireAutomation('missing'), AutomationNotFoundError);
  assert.equal(service.findAutomation('missing'), null);
  assert.equal(service.findAutomation(42), null);
});

test('the view of a webhook rule reports that a secret exists without exposing it', () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    trigger_kind: 'webhook',
    trigger_config: JSON.stringify({ secretHash: 'a'.repeat(64) }),
  });

  const view = toAutomationView(automation);

  assert.deepEqual(view.triggerConfig, { hasSecret: true });
  assert.equal(JSON.stringify(view).includes('a'.repeat(64)), false);
});

test('a rule whose stored config is unreadable still produces a view', () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({ trigger_config: 'not json', action_config: '[]' });

  const view = toAutomationView(automation);

  assert.deepEqual(view.triggerConfig, {});
  assert.deepEqual(view.actionConfig, {});
  assert.equal(view.enabled, true);
});
