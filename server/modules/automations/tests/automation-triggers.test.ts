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

test('a manual fire always runs, even for a rule its trigger would skip', async () => {
  const { deps, triggers } = build();
  const automation = deps.repository.seed({ enabled: 0 });

  const first = await triggers.fireManually(automation);
  const second = await triggers.fireManually(automation);

  assert.equal(first.status, 'success');
  assert.equal(second.status, 'success');
  assert.equal(deps.repository.history.length, 2);
});
