import assert from 'node:assert/strict';
import test from 'node:test';

import { createAutomationAdminService } from '@/modules/automations/services/automation-admin.service.js';
import {
  generateWebhookSecret,
  hashWebhookSecret,
  readWebhookSecret,
  verifyWebhookSecret,
} from '@/modules/automations/services/automation-webhook-secret.js';
import { AutomationValidationError } from '@/modules/automations/automations.errors.js';
import { validateActionConfig, validateTriggerConfig } from '@/modules/automations/automations.validation.js';

import { createFakeRepository } from './support/fake-automation-deps.js';

function build() {
  const repository = createFakeRepository();
  return { repository, admin: createAutomationAdminService(repository) };
}

const TASK_STAGE_RULE = {
  name: 'Start the work',
  trigger_kind: 'task_stage',
  trigger_config: { toStage: 'in_progress', fromStage: 'backlog', project: 'my-app' },
  action_kind: 'prompt_agent',
  action_config: { projectPath: '/home/dev/my-app', promptTemplate: 'Work on {{task}}', skill: 'debug' },
};

test('a rule is stored normalized, with unknown keys dropped', () => {
  const { repository, admin } = build();

  const { automation } = admin.create({
    ...TASK_STAGE_RULE,
    trigger_config: { ...TASK_STAGE_RULE.trigger_config, sneaky: 'value' },
  });

  assert.deepEqual(automation.triggerConfig, {
    toStage: 'in_progress',
    fromStage: 'backlog',
    project: 'my-app',
  });
  assert.deepEqual(JSON.parse(repository.rows[0].trigger_config), automation.triggerConfig);
});

test('camelCase and snake_case bodies are both accepted', () => {
  const { admin } = build();

  const { automation } = admin.create({
    name: 'Either shape',
    triggerKind: 'cron',
    triggerConfig: { cron: '* * * * *' },
    actionKind: 'notify_push',
    actionConfig: { message: 'hi' },
  });

  assert.equal(automation.triggerKind, 'cron');
  assert.equal(automation.actionKind, 'notify_push');
});

test('switching trigger kind re-validates the config against the new kind', () => {
  const { admin, repository } = build();
  const created = admin.create(TASK_STAGE_RULE).automation;
  const row = repository.rows[0];

  assert.throws(
    () => admin.update(row, { trigger_kind: 'cron' }),
    /trigger_config.cron is required/,
  );

  const updated = admin.update(row, { trigger_kind: 'cron', trigger_config: { cron: '0 * * * *' } });
  assert.equal(updated.automation.triggerKind, 'cron');
  assert.deepEqual(updated.automation.triggerConfig, { cron: '0 * * * *' });
  assert.equal(updated.automation.automationId, created.automationId);
});

test('becoming a webhook mints a secret, and leaving it drops the credential', () => {
  const { admin, repository } = build();
  admin.create(TASK_STAGE_RULE);
  const row = repository.rows[0];

  const becameWebhook = admin.update(row, { trigger_kind: 'webhook' });
  assert.equal(typeof becameWebhook.secret, 'string');
  const storedHash = JSON.parse(row.trigger_config).secretHash;
  assert.equal(storedHash, hashWebhookSecret(becameWebhook.secret as string));

  const leftWebhook = admin.update(row, { trigger_kind: 'cron', trigger_config: { cron: '* * * * *' } });
  assert.equal(leftWebhook.secret, undefined);
  assert.equal(JSON.parse(row.trigger_config).secretHash, undefined);
});

test('editing an unrelated field never re-mints or drops a webhook secret', () => {
  const { admin, repository } = build();
  admin.create({ ...TASK_STAGE_RULE, trigger_kind: 'webhook', trigger_config: {} });
  const row = repository.rows[0];
  const originalHash = JSON.parse(row.trigger_config).secretHash;

  const renamed = admin.update(row, { name: 'Renamed' });

  assert.equal(renamed.secret, undefined);
  assert.equal(JSON.parse(row.trigger_config).secretHash, originalHash);
});

test('a client cannot choose a webhook rule\'s stored digest', () => {
  const { admin, repository } = build();
  admin.create({
    ...TASK_STAGE_RULE,
    trigger_kind: 'webhook',
    trigger_config: { secretHash: hashWebhookSecret('chosen-by-the-client') },
  });

  const storedHash = JSON.parse(repository.rows[0].trigger_config).secretHash;
  assert.notEqual(storedHash, hashWebhookSecret('chosen-by-the-client'));
});

test('deleting returns the rule it removed', () => {
  const { admin, repository } = build();
  admin.create(TASK_STAGE_RULE);

  const removed = admin.remove(repository.rows[0]);

  assert.equal(removed.name, 'Start the work');
  assert.equal(repository.rows.length, 0);
});

test('trigger configs are validated per kind', () => {
  assert.throws(() => validateTriggerConfig('task_stage', { toStage: 'shipped' }), AutomationValidationError);
  assert.throws(() => validateTriggerConfig('task_stage', {}), /toStage must be one of/);
  assert.throws(() => validateTriggerConfig('cron', { cron: 'nope' }), /is invalid/);
  assert.throws(() => validateTriggerConfig('quota_threshold', { profileId: 'p' }), /thresholdPct must be a number/);
  assert.throws(
    () => validateTriggerConfig('quota_threshold', { profileId: 'p', thresholdPct: 101 }),
    /between 1 and 100/,
  );
  assert.throws(() => validateTriggerConfig('cron', 'a string'), /must be an object/);

  // A quota rule without a cooldown gets the documented default.
  assert.deepEqual(validateTriggerConfig('quota_threshold', { profileId: 'p', thresholdPct: 85 }), {
    profileId: 'p',
    thresholdPct: 85,
    cooldownMinutes: 60,
  });
});

test('task_backlog trigger configs require a project and bound maxConcurrent', () => {
  assert.throws(() => validateTriggerConfig('task_backlog', {}), /project is required/);
  assert.throws(
    () => validateTriggerConfig('task_backlog', { project: 'my-app', maxConcurrent: 0 }),
    /between 1 and 10/,
  );
  assert.throws(
    () => validateTriggerConfig('task_backlog', { project: 'my-app', maxConcurrent: 11 }),
    /between 1 and 10/,
  );
  assert.throws(
    () => validateTriggerConfig('task_backlog', { project: 'my-app', maxConcurrent: 2.5 }),
    /must be an integer/,
  );

  // No maxConcurrent supplied gets the documented default.
  assert.deepEqual(validateTriggerConfig('task_backlog', { project: 'my-app' }), {
    project: 'my-app',
    maxConcurrent: 2,
  });
  assert.deepEqual(validateTriggerConfig('task_backlog', { project: 'my-app', maxConcurrent: 5 }), {
    project: 'my-app',
    maxConcurrent: 5,
  });
});

test('action configs are validated per kind', () => {
  assert.throws(() => validateActionConfig('prompt_agent', { promptTemplate: 'x' }), /projectPath is required/);
  assert.throws(
    () => validateActionConfig('prompt_agent', { projectPath: '/p', promptTemplate: 'x', provider: 'gemini' }),
    /provider must be one of/,
  );
  assert.throws(() => validateActionConfig('create_task', { project: 'p' }), /title is required/);
  assert.throws(() => validateActionConfig('notify_push', {}), /message is required/);
  assert.throws(() => validateActionConfig('notify_push', { message: 'hi', userId: 'me' }), /must be a number/);

  assert.deepEqual(validateActionConfig('create_task', { project: 'p', title: 't', description: '' }), {
    project: 'p',
    title: 't',
  });
});

test('pickup_task action configs require a projectPath and validate the provider', () => {
  assert.throws(() => validateActionConfig('pickup_task', {}), /projectPath is required/);
  assert.throws(
    () => validateActionConfig('pickup_task', { projectPath: '/p', provider: 'gemini' }),
    /provider must be one of/,
  );

  assert.deepEqual(validateActionConfig('pickup_task', { projectPath: '/p' }), { projectPath: '/p' });
  assert.deepEqual(
    validateActionConfig('pickup_task', { projectPath: '/p', provider: 'claude', baseBranch: 'main' }),
    { projectPath: '/p', provider: 'claude', baseBranch: 'main' },
  );
});

test('a secret only verifies against its own digest', () => {
  const secret = generateWebhookSecret();
  const hash = hashWebhookSecret(secret);

  assert.equal(verifyWebhookSecret(secret, hash), true);
  assert.equal(verifyWebhookSecret(`${secret} `, hash), false);
  assert.equal(verifyWebhookSecret(generateWebhookSecret(), hash), false);
  assert.equal(verifyWebhookSecret('', hash), false);
  assert.equal(verifyWebhookSecret(null, hash), false);
});

test('a rule with no stored digest can never be fired by a webhook', () => {
  assert.equal(verifyWebhookSecret(generateWebhookSecret(), undefined), false);
  assert.equal(verifyWebhookSecret(generateWebhookSecret(), ''), false);
  assert.equal(verifyWebhookSecret(generateWebhookSecret(), 'short'), false);
  assert.equal(verifyWebhookSecret(generateWebhookSecret(), 'z'.repeat(64)), false);
});

test('the secret is read from either the dedicated header or a bearer token', () => {
  assert.equal(readWebhookSecret({ 'x-automation-secret': ' abc ' }), 'abc');
  assert.equal(readWebhookSecret({ authorization: 'Bearer abc' }), 'abc');
  assert.equal(readWebhookSecret({ authorization: 'bearer abc' }), 'abc');
  assert.equal(readWebhookSecret({ authorization: 'Basic abc' }), null);
  assert.equal(readWebhookSecret({}), null);
});
