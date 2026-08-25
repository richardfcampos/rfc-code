/**
 * Dispatch tests for `useTaskWorktree` on `prompt_agent`.
 *
 * This is the one thing the first-pass reviewer's carrier needed that
 * `prompt_agent` did not already have: a rule that serves every task on a
 * board cannot name a worktree in its static config, so `useTaskWorktree`
 * resolves it from whichever task fired the trigger instead. Covers the
 * worktree resolution, the duplicate-agent guard it shares with
 * `pickup_task`, the fallback when there is nothing to resolve from, and that
 * a rule without the flag is unaffected.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { executeAutomationAction } from '@/modules/automations/services/automation-actions.service.js';
import { taskVariables } from '@/modules/automations/services/automation-template.js';
import type { AutomationTriggerContext } from '@/modules/automations/automations.types.js';
import type { TaskRow } from '@/modules/database/index.js';

import { TASK, createFakeDeps } from './support/fake-automation-deps.js';

function taskContext(task: TaskRow): AutomationTriggerContext {
  return {
    dedupeKey: null,
    variables: { 'automation.name': 'Review it', ...taskVariables(task, 'in_progress') },
    task,
  };
}

test('useTaskWorktree ensures the worktree for the firing task\'s branch and dispatches there', async () => {
  const deps = createFakeDeps();
  const task: TaskRow = { ...TASK, worktree_branch: 'auto/task-1' };
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      promptTemplate: 'Review task {{task.id}} on {{task.worktreeBranch}}.',
      useTaskWorktree: true,
    }),
  });

  await executeAutomationAction(deps, automation, taskContext(task));

  assert.deepEqual(deps.worktrees.ensured, [
    { projectPath: '/home/dev/my-app', branch: 'auto/task-1', baseBranch: null },
  ]);
  assert.equal(deps.prompts.length, 1);
  assert.equal(deps.prompts[0].worktreePath, '/worktrees/auto/task-1');
  assert.equal(deps.prompts[0].worktreeBranch, 'auto/task-1');
  assert.equal(deps.prompts[0].prompt, 'Review task task-1 on auto/task-1.');
});

test('a live session already on the branch is a clean skip, not a second agent', async () => {
  const deps = createFakeDeps({
    agent: {
      promptAgent: async () => {
        throw new Error('must not dispatch while a session is live on the branch');
      },
      hasLiveSessionForBranch: (branch) => branch === 'auto/task-1',
    },
  });
  const task: TaskRow = { ...TASK, worktree_branch: 'auto/task-1' };
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      promptTemplate: 'Review task {{task.id}}.',
      useTaskWorktree: true,
    }),
  });

  const outcome = await executeAutomationAction(deps, automation, taskContext(task));

  // Reported as an unrecorded skip, not a plain success detail: the guard
  // that produced it (the author's own live run, still mid-turn) can look
  // identical the next time this task moves to review, so nothing may be
  // written under this firing's dedupe key.
  assert.ok(typeof outcome !== 'string', 'expected an unrecorded skip, not a recorded detail');
  assert.match(outcome.detail, /already has a live agent session on auto\/task-1/);
  assert.equal(deps.worktrees.ensured.length, 0);
});

test('a firing with no task falls back to the static projectPath, no worktree lookup', async () => {
  const deps = createFakeDeps();
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      promptTemplate: 'Cron review sweep.',
      useTaskWorktree: true,
    }),
  });

  await executeAutomationAction(deps, automation, { dedupeKey: null, variables: {} });

  assert.equal(deps.worktrees.ensured.length, 0);
  assert.equal(deps.prompts.length, 1);
  assert.equal(deps.prompts[0].worktreePath, null);
  assert.equal(deps.prompts[0].worktreeBranch, null);
});

test('a task with no worktree branch falls back to the static config the same way', async () => {
  const deps = createFakeDeps();
  const task: TaskRow = { ...TASK, worktree_branch: null };
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      promptTemplate: 'Review task {{task.id}}.',
      worktreePath: '/home/dev/my-app',
      worktreeBranch: 'main',
      useTaskWorktree: true,
    }),
  });

  await executeAutomationAction(deps, automation, taskContext(task));

  assert.equal(deps.worktrees.ensured.length, 0);
  assert.equal(deps.prompts[0].worktreePath, '/home/dev/my-app');
  assert.equal(deps.prompts[0].worktreeBranch, 'main');
});

test('an existing prompt_agent rule without the flag is unaffected by a task carrying a branch', async () => {
  const deps = createFakeDeps();
  const task: TaskRow = { ...TASK, worktree_branch: 'auto/task-1' };
  const automation = deps.repository.seed({
    action_kind: 'prompt_agent',
    action_config: JSON.stringify({
      projectPath: '/home/dev/my-app',
      promptTemplate: 'Notify about {{task.id}}.',
      // No useTaskWorktree: pre-existing rules keep running in the main checkout.
    }),
  });

  await executeAutomationAction(deps, automation, taskContext(task));

  assert.equal(deps.worktrees.ensured.length, 0);
  assert.equal(deps.prompts[0].worktreePath, null);
  assert.equal(deps.prompts[0].worktreeBranch, null);
});
