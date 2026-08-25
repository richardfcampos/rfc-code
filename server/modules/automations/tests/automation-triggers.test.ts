import assert from 'node:assert/strict';
import test from 'node:test';

import { createAutomationTriggerService } from '@/modules/automations/services/automation-triggers.service.js';
import { createAutomationFiringService } from '@/modules/automations/automations.service.js';
import type { AutomationServiceDeps } from '@/modules/automations/automations.types.js';

import { TASK, createFakeDeps, type FakeAutomationDeps } from './support/fake-automation-deps.js';

function build(overrides: Partial<AutomationServiceDeps> = {}): {
  deps: FakeAutomationDeps;
  triggers: ReturnType<typeof createAutomationTriggerService>;
} {
  const deps = createFakeDeps(overrides);
  const firing = createAutomationFiringService(deps);
  return { deps, triggers: createAutomationTriggerService(deps, firing) };
}

test('a task landing on the watched stage fires the rule', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({ trigger_config: JSON.stringify({ toStage: 'in_progress' }) });

  const results = await triggers.onTaskStageChanged({ task: TASK, previousStage: 'backlog' });

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'success');
  assert.equal(deps.pushes[0].message, 'Moved: Ship the board');
});

test('a task landing on another stage fires nothing', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({ trigger_config: JSON.stringify({ toStage: 'done' }) });

  const results = await triggers.onTaskStageChanged({ task: TASK, previousStage: 'backlog' });

  assert.deepEqual(results, []);
  assert.equal(deps.pushes.length, 0);
});

test('fromStage and project narrow a rule further', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_config: JSON.stringify({ toStage: 'in_progress', fromStage: 'review' }),
  });
  deps.repository.seed({
    trigger_config: JSON.stringify({ toStage: 'in_progress', project: 'another-app' }),
  });
  const matching = deps.repository.seed({
    trigger_config: JSON.stringify({ toStage: 'in_progress', fromStage: 'backlog', project: 'my-app' }),
  });

  const results = await triggers.onTaskStageChanged({ task: TASK, previousStage: 'backlog' });

  assert.equal(results.length, 1);
  assert.equal(results[0].automationId, matching.automation_id);
});

test('disabled rules are never evaluated', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({ enabled: 0 });

  assert.deepEqual(await triggers.onTaskStageChanged({ task: TASK, previousStage: 'backlog' }), []);
  assert.equal(deps.pushes.length, 0);
});

test('the same transition observed twice only fires once', async () => {
  const { deps, triggers } = build();
  deps.repository.seed();

  await triggers.onTaskStageChanged({ task: TASK, previousStage: 'backlog' });
  const second = await triggers.onTaskStageChanged({ task: TASK, previousStage: 'review' });

  assert.equal(second[0].status, 'skipped');
  assert.equal(deps.pushes.length, 1);
});

test('one rule throwing does not stop the rest of the board hook', async () => {
  const { deps, triggers } = build({
    notify: {
      push: ({ automationName }) => {
        if (automationName === 'Broken') throw new Error('nope');
      },
    },
  });
  deps.repository.seed({ name: 'Broken' });
  deps.repository.seed({ name: 'Fine' });

  const results = await triggers.onTaskStageChanged({ task: TASK, previousStage: 'backlog' });

  assert.deepEqual(results.map((result) => result.status), ['failed', 'success']);
});

test('a cron rule fires on the minute it is due, and only once per minute', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'cron',
    trigger_config: JSON.stringify({ cron: '0 3 * * *' }),
    action_config: JSON.stringify({ message: 'Nightly sweep' }),
  });

  const due = new Date(2026, 7, 24, 3, 0);
  assert.equal((await triggers.runTick(new Date(2026, 7, 24, 2, 59)))[0], undefined);
  assert.equal((await triggers.runTick(due))[0].status, 'success');
  assert.equal((await triggers.runTick(due))[0].status, 'skipped');
  assert.equal(deps.pushes.length, 1);
});

test('a cron rule with an unparseable expression is skipped, not fatal', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({ trigger_kind: 'cron', trigger_config: JSON.stringify({ cron: 'not a cron' }) });
  deps.repository.seed({ trigger_kind: 'cron', trigger_config: JSON.stringify({ cron: '* * * * *' }) });

  const results = await triggers.runTick(new Date(2026, 7, 24, 3, 0));

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'success');
});

test('a quota rule fires once usage reaches the threshold', async () => {
  const { deps, triggers } = build({
    usage: {
      getUsage: async () => ({ supported: true, status: 'ok', windows: [{ utilization: 40 }, { utilization: 91 }] }),
    },
  });
  deps.repository.seed({
    trigger_kind: 'quota_threshold',
    trigger_config: JSON.stringify({ profileId: 'profile-a', thresholdPct: 85, cooldownMinutes: 60 }),
    action_config: JSON.stringify({ message: 'Usage at {{quota.usagePct}}% of {{quota.thresholdPct}}%' }),
  });

  const results = await triggers.runTick(new Date(2026, 7, 24, 10, 0));

  assert.equal(results[0].status, 'success');
  assert.equal(deps.pushes[0].message, 'Usage at 91% of 85%');
});

test('a quota rule stays quiet below the threshold and while usage is unknown', async () => {
  let snapshot = { supported: true, status: 'ok', windows: [{ utilization: 10 }] };
  const { deps, triggers } = build({ usage: { getUsage: async () => snapshot } });
  deps.repository.seed({
    trigger_kind: 'quota_threshold',
    trigger_config: JSON.stringify({ profileId: 'profile-a', thresholdPct: 85 }),
  });

  assert.deepEqual(await triggers.runTick(new Date(2026, 7, 24, 10, 0)), []);

  snapshot = { supported: true, status: 'unavailable', windows: [] };
  assert.deepEqual(await triggers.runTick(new Date(2026, 7, 24, 10, 1)), []);

  snapshot = { supported: false, status: 'ok', windows: [{ utilization: 99 }] };
  assert.deepEqual(await triggers.runTick(new Date(2026, 7, 24, 10, 2)), []);
  assert.equal(deps.pushes.length, 0);
});

test('a quota rule fires at most once per cooldown window while usage stays high', async () => {
  const { deps, triggers } = build({
    usage: { getUsage: async () => ({ supported: true, status: 'ok', windows: [{ utilization: 99 }] }) },
  });
  deps.repository.seed({
    trigger_kind: 'quota_threshold',
    trigger_config: JSON.stringify({ profileId: 'profile-a', thresholdPct: 85, cooldownMinutes: 60 }),
  });

  await triggers.runTick(new Date(2026, 7, 24, 10, 0));
  await triggers.runTick(new Date(2026, 7, 24, 10, 30));
  assert.equal(deps.pushes.length, 1);

  // Past the cooldown the rule re-arms and reports again.
  await triggers.runTick(new Date(2026, 7, 24, 12, 30));
  assert.equal(deps.pushes.length, 2);
});

test('a usage lookup that fails skips its rule instead of failing the tick', async () => {
  const { deps, triggers } = build({
    usage: {
      getUsage: async () => {
        throw new Error('usage endpoint down');
      },
    },
  });
  deps.repository.seed({
    trigger_kind: 'quota_threshold',
    trigger_config: JSON.stringify({ profileId: 'profile-a', thresholdPct: 85 }),
  });

  assert.deepEqual(await triggers.runTick(new Date(2026, 7, 24, 10, 0)), []);
});

test('a webhook delivery with an idempotency key is only honoured once', async () => {
  const { deps, triggers } = build();
  const automation = deps.repository.seed({
    trigger_kind: 'webhook',
    action_config: JSON.stringify({ message: 'Deploy of {{payload.ref}}' }),
  });

  const first = await triggers.fireWebhook(automation, { ref: 'main' }, 'delivery-1');
  const repeat = await triggers.fireWebhook(automation, { ref: 'main' }, 'delivery-1');
  const other = await triggers.fireWebhook(automation, { ref: 'next' }, 'delivery-2');

  assert.equal(first.status, 'success');
  assert.equal(repeat.status, 'skipped');
  assert.equal(other.status, 'success');
  assert.deepEqual(deps.pushes.map((push) => push.message), ['Deploy of main', 'Deploy of next']);
});

test('a webhook delivery without an idempotency key fires every time', async () => {
  const { deps, triggers } = build();
  const automation = deps.repository.seed({ trigger_kind: 'webhook' });

  await triggers.fireWebhook(automation, {}, null);
  await triggers.fireWebhook(automation, {}, null);

  assert.equal(deps.pushes.length, 2);
});

test('backlog concurrency gate: at the limit fires nothing, one below fires once', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app', maxConcurrent: 2 }),
    action_config: JSON.stringify({ message: 'Picked up {{task}}' }),
  });
  const inProgressA = deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  deps.board.seed({ project_name: 'my-app', stage: 'backlog', title: 'Ready ticket' });

  assert.deepEqual(await triggers.runTick(new Date(2026, 7, 24, 10, 0)), []);

  // Dropping one in_progress task takes the project below the ceiling.
  inProgressA.stage = 'done';
  const results = await triggers.runTick(new Date(2026, 7, 24, 10, 1));

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'success');
  assert.equal(deps.pushes[0].message, 'Picked up Ready ticket');
});

test('backlog election picks the oldest ready ticket first', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app' }),
    action_config: JSON.stringify({ message: 'Picked up {{task.id}}' }),
  });
  const older = deps.board.seed({ project_name: 'my-app', created_at: '2026-08-01T00:00:00.000Z' });
  deps.board.seed({ project_name: 'my-app', created_at: '2026-08-10T00:00:00.000Z' });

  await triggers.runTick(new Date(2026, 7, 24, 10, 0));

  assert.equal(deps.pushes[0].message, `Picked up ${older.id}`);
});

test('a backlog ticket with an unfinished blocker is never elected', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app' }),
    action_config: JSON.stringify({ message: 'Picked up {{task.id}}' }),
  });
  const blocker = deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  deps.board.seed({ project_name: 'my-app', dependsOn: [blocker.id] });

  assert.deepEqual(await triggers.runTick(new Date(2026, 7, 24, 10, 0)), []);
  assert.equal(deps.pushes.length, 0);
});

test('the same backlog ticket in the same state only fires once', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app', maxConcurrent: 10 }),
    action_config: JSON.stringify({ message: 'Picked up {{task.id}}' }),
  });
  deps.board.seed({ project_name: 'my-app' });

  const first = await triggers.runTick(new Date(2026, 7, 24, 10, 0));
  const second = await triggers.runTick(new Date(2026, 7, 24, 10, 1));

  assert.equal(first.length, 1);
  assert.equal(first[0].status, 'success');
  assert.deepEqual(second, []);
  assert.equal(deps.pushes.length, 1);
});

test('a re-backlogged ticket with a newer updated_at fires again', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app', maxConcurrent: 10 }),
    action_config: JSON.stringify({ message: 'Picked up {{task.id}}' }),
  });
  const task = deps.board.seed({ project_name: 'my-app' });

  await triggers.runTick(new Date(2026, 7, 24, 10, 0));
  task.updated_at = '2026-08-25T00:00:00.000Z';
  const second = await triggers.runTick(new Date(2026, 7, 24, 10, 1));

  assert.equal(second.length, 1);
  assert.equal(second[0].status, 'success');
  assert.equal(deps.pushes.length, 2);
});

test('a permanently failed ticket does not starve the ticket behind it', async () => {
  const { deps, triggers } = build();
  const automation = deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app', maxConcurrent: 10 }),
    action_config: JSON.stringify({ message: 'Picked up {{task.id}}' }),
  });
  const stuck = deps.board.seed({ project_name: 'my-app', created_at: '2026-08-01T00:00:00.000Z' });
  const next = deps.board.seed({ project_name: 'my-app', created_at: '2026-08-10T00:00:00.000Z' });

  // Simulates a pickup that already exhausted its retries for this ticket's
  // current identity: the history exists, so election must not retry it.
  deps.repository.runs.record({
    automationId: automation.automation_id,
    status: 'failed',
    dedupeKey: `backlog:${stuck.id}:${stuck.updated_at}`,
  });

  const results = await triggers.runTick(new Date(2026, 7, 24, 10, 0));

  assert.equal(results.length, 1);
  assert.equal(deps.pushes[0].message, `Picked up ${next.id}`);
});

test('a stored task_backlog config without maxConcurrent falls back to 2', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app' }),
    action_config: JSON.stringify({ message: 'Picked up {{task.id}}' }),
  });
  deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  deps.board.seed({ project_name: 'my-app', stage: 'backlog' });

  assert.deepEqual(await triggers.runTick(new Date(2026, 7, 24, 10, 0)), []);
});

test('a task_backlog rule without a project is skipped, not fatal to the tick', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({ trigger_kind: 'task_backlog', trigger_config: JSON.stringify({}) });
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app' }),
    action_config: JSON.stringify({ message: 'Picked up {{task.id}}' }),
  });
  deps.board.seed({ project_name: 'my-app' });

  const results = await triggers.runTick(new Date(2026, 7, 24, 10, 0));

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'success');
});

test('a finished plan is integrated once with an "integrate:" dedupe key, and a second tick fires nothing', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app', maxConcurrent: 10 }),
    action_config: JSON.stringify({ message: 'Integrated {{task.id}}' }),
  });
  const parent = deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  deps.board.seed({ project_name: 'my-app', stage: 'done', parentTaskId: parent.id });
  deps.board.seed({ project_name: 'my-app', stage: 'done', parentTaskId: parent.id });

  const first = await triggers.runTick(new Date(2026, 7, 24, 10, 0));

  assert.equal(first.length, 1);
  assert.equal(first[0].status, 'success');
  assert.equal(deps.pushes[0].message, `Integrated ${parent.id}`);
  assert.match(deps.repository.history[0].dedupe_key ?? '', /^integrate:/);

  const second = await triggers.runTick(new Date(2026, 7, 24, 10, 1));

  assert.deepEqual(second, []);
  assert.equal(deps.pushes.length, 1);
});

test('reopening a finished child and re-finishing it integrates the parent again', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app', maxConcurrent: 10 }),
    action_config: JSON.stringify({ message: 'Integrated {{task.id}}' }),
  });
  const parent = deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  const child = deps.board.seed({ project_name: 'my-app', stage: 'done', parentTaskId: parent.id });

  await triggers.runTick(new Date(2026, 7, 24, 10, 0));
  assert.equal(deps.pushes.length, 1);

  // Reopened: the parent is no longer a candidate while a child is unfinished.
  child.stage = 'in_progress';
  child.updated_at = '2026-08-25T00:00:00.000Z';
  assert.deepEqual(await triggers.runTick(new Date(2026, 7, 24, 10, 1)), []);

  // Re-finished with a newer updated_at: the fingerprint changed, so it fires again.
  child.stage = 'done';
  child.updated_at = '2026-08-25T00:01:00.000Z';
  const third = await triggers.runTick(new Date(2026, 7, 24, 10, 2));

  assert.equal(third.length, 1);
  assert.equal(third[0].status, 'success');
  assert.equal(deps.pushes.length, 2);
});

test('a project at its concurrency ceiling still integrates a finished plan (the no-gate rule)', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app', maxConcurrent: 1 }),
    action_config: JSON.stringify({ message: 'Fired {{task.id}}' }),
  });
  // Fills the only slot, unrelated to the plan being integrated.
  deps.board.seed({ project_name: 'my-app', stage: 'in_progress', title: 'Other work' });
  const parent = deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  deps.board.seed({ project_name: 'my-app', stage: 'done', parentTaskId: parent.id });
  // A ready backlog ticket that the ceiling must still block.
  deps.board.seed({ project_name: 'my-app', stage: 'backlog', title: 'Waiting ticket' });

  const results = await triggers.runTick(new Date(2026, 7, 24, 10, 0));

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'success');
  assert.equal(deps.pushes[0].message, `Fired ${parent.id}`);
});

test('a decomposed parent with an unfinished child does not consume the only concurrency slot', async () => {
  const { deps, triggers } = build();
  deps.repository.seed({
    trigger_kind: 'task_backlog',
    trigger_config: JSON.stringify({ project: 'my-app', maxConcurrent: 1 }),
    action_config: JSON.stringify({ message: 'Picked up {{task.id}}' }),
  });
  deps.board.seed({ project_name: 'my-app', stage: 'in_progress' });
  const subtask = deps.board.seed({
    project_name: 'my-app',
    stage: 'backlog',
    parentTaskId: deps.board.tasks[0].id,
  });

  const results = await triggers.runTick(new Date(2026, 7, 24, 10, 0));

  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'success');
  assert.equal(deps.pushes[0].message, `Picked up ${subtask.id}`);
});

test('a manual fire always runs, even for a rule its trigger would skip', async () => {
  const { deps, triggers } = build();
  const automation = deps.repository.seed({ enabled: 0 });

  const first = await triggers.fireManually(automation);
  const second = await triggers.fireManually(automation);

  assert.equal(first.status, 'success');
  assert.equal(second.status, 'success');
  assert.equal(deps.repository.history.length, 2);
});
