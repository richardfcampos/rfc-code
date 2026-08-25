import assert from 'node:assert/strict';
import test from 'node:test';

import type { AutomationTriggerContext } from '@/modules/automations/automations.types.js';
import { pickupTask } from '@/modules/automations/services/task-pickup.service.js';
import { MAX_ATTEMPTS, createAutomationFiringService } from '@/modules/automations/automations.service.js';

import { createFakeDeps, type FakeBoardTaskSeed } from './support/fake-automation-deps.js';

function contextFor(task: ReturnType<typeof seedElected>): AutomationTriggerContext {
  return { dedupeKey: null, variables: {}, task };
}

function seedElected(deps: ReturnType<typeof createFakeDeps>, overrides: FakeBoardTaskSeed = {}) {
  return deps.board.seed({ stage: 'backlog', title: 'Ship the thing', description: 'Do it', ...overrides });
}

function actionConfig(): { projectPath: string } {
  return { projectPath: '/home/dev/my-app' };
}

test('happy path: creates a worktree, moves the card, dispatches once, names the session', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps);
  const branch = `auto/task-${elected.id}`;

  const detail = await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.equal(deps.worktrees.ensured.length, 1);
  assert.deepEqual(deps.worktrees.ensured[0], {
    projectPath: '/home/dev/my-app',
    branch,
    baseBranch: null,
  });

  assert.equal(deps.board.moved.length, 1);
  assert.deepEqual(deps.board.moved[0], { taskId: elected.id, worktreeBranch: branch });
  assert.equal(deps.board.getTask(elected.id)?.stage, 'in_progress');
  assert.equal(deps.board.getTask(elected.id)?.worktree_branch, branch);

  assert.equal(deps.prompts.length, 1);
  assert.equal(deps.prompts[0].worktreeBranch, branch);

  assert.equal(detail, `Picked up task ${elected.id} on ${branch} in session session-1`);
});

test('claim race: task now in review returns a clean abort with no side effects', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps, { stage: 'review' });

  const detail = await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.match(detail, /no longer in backlog/);
  assert.equal(deps.worktrees.ensured.length, 0);
  assert.equal(deps.board.moved.length, 0);
  assert.equal(deps.prompts.length, 0);
});

test('claim race: task deleted between election and action is the same clean abort', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps);
  deps.board.tasks.splice(deps.board.tasks.findIndex((task) => task.id === elected.id), 1);

  const detail = await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.match(detail, /no longer in backlog/);
  assert.equal(deps.worktrees.ensured.length, 0);
  assert.equal(deps.board.moved.length, 0);
  assert.equal(deps.prompts.length, 0);
});

test('retry resume: task already in_progress on the same branch proceeds to dispatch', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps);
  const branch = `auto/task-${elected.id}`;
  await deps.board.moveToInProgress(elected.id, branch, 'backlog');
  deps.board.moved.length = 0; // reset: only the retry's own writes should count below

  const detail = await pickupTask(deps, actionConfig(), contextFor(elected));

  // Already in_progress on the right branch: no second move, but dispatch proceeds.
  assert.equal(deps.board.moved.length, 0);
  assert.equal(deps.prompts.length, 1);
  assert.equal(detail, `Picked up task ${elected.id} on ${branch} in session session-1`);
});

test('retry resume: task in_progress on a different branch aborts', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps);
  await deps.board.moveToInProgress(elected.id, 'someone-elses-branch', 'backlog');

  const detail = await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.match(detail, /no longer in backlog/);
  assert.equal(deps.worktrees.ensured.length, 0);
  assert.equal(deps.prompts.length, 0);
});

test('a live agent session on the branch skips dispatch with a clean abort', async () => {
  const deps = createFakeDeps({
    agent: {
      promptAgent: async () => {
        throw new Error('must not dispatch while a live session already owns the branch');
      },
      hasLiveSessionForBranch: () => true,
    },
  });
  const elected = seedElected(deps);

  const detail = await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.match(detail, /already has a live agent session/);
  assert.equal(deps.worktrees.ensured.length, 0);
  assert.equal(deps.board.moved.length, 0);
  assert.equal(deps.board.getTask(elected.id)?.stage, 'backlog');
});

test('CAS guard: a card dragged away while its worktree was being prepared aborts instead of being pulled back', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps);
  deps.worktrees.ensureWorktree = async (input) => {
    // Simulate a person dragging the card to review during the multi-second
    // worktree creation this stands in for.
    const task = deps.board.tasks.find((candidate) => candidate.id === elected.id);
    if (task) task.stage = 'review';
    return { worktreePath: `/worktrees/${input.branch}`, branch: input.branch };
  };

  const detail = await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.match(detail, /left backlog while its worktree was being prepared/);
  assert.equal(deps.board.moved.length, 0);
  assert.equal(deps.prompts.length, 0);
  assert.equal(deps.board.getTask(elected.id)?.stage, 'review');
});

test('worktree reuse: an existing entry for the branch is returned without creating one', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps);
  const branch = `auto/task-${elected.id}`;
  let createCalls = 0;
  deps.worktrees.ensureWorktree = async (input) => {
    createCalls += 1;
    deps.worktrees.ensured.push(input);
    return { worktreePath: `/worktrees/${input.branch}`, branch: input.branch };
  };

  await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.equal(createCalls, 1);
  assert.equal(deps.worktrees.ensured[0].branch, branch);
});

test('worktree failure throws and surfaces as a failed attempt through the firing service', async () => {
  const deps = createFakeDeps({
    worktrees: {
      ensureWorktree: async () => {
        throw new Error('worktree creation failed');
      },
    },
  });
  const elected = seedElected(deps);
  const automation = deps.repository.seed({
    action_kind: 'pickup_task',
    action_config: JSON.stringify(actionConfig()),
  });

  const firing = createAutomationFiringService(deps);
  const result = await firing.fire(automation, contextFor(elected));

  assert.equal(result.status, 'failed');
  assert.match(result.detail, /worktree creation failed/);
  assert.equal(result.attempts, MAX_ATTEMPTS);
});

test('spawn failure on a fresh pickup reverts the card to backlog and rethrows', async () => {
  const deps = createFakeDeps({
    agent: {
      promptAgent: async () => {
        throw new Error('spawn unavailable');
      },
      hasLiveSessionForBranch: () => false,
    },
  });
  const elected = seedElected(deps);
  const branch = `auto/task-${elected.id}`;

  await assert.rejects(() => pickupTask(deps, actionConfig(), contextFor(elected)), /spawn unavailable/);

  // A deterministic spawn failure must not strand the card in_progress —
  // that would eat a concurrency slot with nothing running.
  assert.equal(deps.board.getTask(elected.id)?.stage, 'backlog');
  assert.deepEqual(deps.board.reverted, [elected.id]);

  // The next attempt (same firing) re-elects fresh rather than resuming a
  // ghost claim.
  const goodDeps = createFakeDeps({ board: deps.board, worktrees: deps.worktrees });
  const detail = await pickupTask(goodDeps, actionConfig(), contextFor(elected));
  assert.equal(detail, `Picked up task ${elected.id} on ${branch} in session session-1`);
});

test('spawn failure on a retry-resume also reverts the card to backlog', async () => {
  const deps = createFakeDeps({
    agent: {
      promptAgent: async () => {
        throw new Error('spawn unavailable');
      },
      hasLiveSessionForBranch: () => false,
    },
  });
  const elected = seedElected(deps);
  const branch = `auto/task-${elected.id}`;
  // A prior attempt already moved the card to in_progress on this branch;
  // this attempt is the retry that finds it there and tries to dispatch again.
  await deps.board.moveToInProgress(elected.id, branch, 'backlog');

  await assert.rejects(() => pickupTask(deps, actionConfig(), contextFor(elected)), /spawn unavailable/);

  assert.equal(deps.board.getTask(elected.id)?.stage, 'backlog');
  assert.deepEqual(deps.board.reverted, [elected.id]);
});

test('a revert failure is swallowed so the original dispatch error still surfaces', async () => {
  const deps = createFakeDeps({
    agent: {
      promptAgent: async () => {
        throw new Error('spawn unavailable');
      },
      hasLiveSessionForBranch: () => false,
    },
  });
  const elected = seedElected(deps);
  deps.board.revertToBacklog = async () => {
    throw new Error('board unreachable');
  };

  await assert.rejects(() => pickupTask(deps, actionConfig(), contextFor(elected)), /spawn unavailable/);
});

test('the prompt carries the worktree path, branch, and the task_update_stage instruction', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps, { title: 'Fix the thing', description: 'Details here' });
  const branch = `auto/task-${elected.id}`;

  await pickupTask(deps, actionConfig(), contextFor(elected));

  const prompt = deps.prompts[0].prompt;
  assert.match(prompt, /Fix the thing/);
  assert.match(prompt, /Details here/);
  assert.match(prompt, new RegExp(`/worktrees/${branch}`));
  assert.match(prompt, new RegExp(branch));
  assert.match(prompt, /task_update_stage/);
  assert.match(prompt, /task_evidence_add/);
});

test('the prompt puts standing instructions before the task data, delimited as data', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps, { title: 'Fix the thing', description: 'Details here' });

  await pickupTask(deps, actionConfig(), contextFor(elected));

  const prompt = deps.prompts[0].prompt;
  const confinementIndex = prompt.indexOf('do not touch the main checkout');
  const dataWarningIndex = prompt.indexOf('data authored by a user or an external system');
  const dataMarkerIndex = prompt.indexOf('BEGIN TASK DATA');
  const titleIndex = prompt.indexOf('Fix the thing');

  assert.ok(confinementIndex >= 0, 'confinement instruction is present');
  assert.ok(dataWarningIndex > confinementIndex, 'the data warning follows the standing instructions');
  assert.ok(dataMarkerIndex > dataWarningIndex, 'the fenced data block follows the warning');
  assert.ok(titleIndex > dataMarkerIndex, 'the task title sits inside the fenced data block');
});

test('pickup_task throws when fired with no elected task in context', async () => {
  const deps = createFakeDeps();
  await assert.rejects(
    () => pickupTask(deps, actionConfig(), { dedupeKey: null, variables: {} }),
    /no elected task/,
  );
});

test('a top-level ticket prompt names the maestro skill, carries task_decompose, and forbids task_delegate', async () => {
  const deps = createFakeDeps();
  const elected = seedElected(deps);

  await pickupTask(deps, actionConfig(), contextFor(elected));

  const prompt = deps.prompts[0].prompt;
  assert.match(prompt, /maestro/);
  assert.match(prompt, /task_decompose/);
  assert.match(prompt, /Do NOT call task_delegate/);
  assert.match(prompt, /END YOUR RUN/);
});

test('a subtask prompt does not offer decomposition, and finishes on done, not review', async () => {
  const deps = createFakeDeps();
  const parent = deps.board.seed({ stage: 'in_progress', worktree_branch: 'auto/task-parent-1' });
  const elected = seedElected(deps, { parentTaskId: parent.id });

  await pickupTask(deps, actionConfig(), contextFor(elected));

  const prompt = deps.prompts[0].prompt;
  assert.doesNotMatch(prompt, /task_decompose/);
  assert.doesNotMatch(prompt, /maestro/);
  assert.match(prompt, /move the card to done with the task_update_stage tool/);
  assert.match(prompt, /Do NOT move it to review/);
  assert.doesNotMatch(prompt, /move the card to review/);
});

test("a subtask's worktree is cut from its parent's branch", async () => {
  const deps = createFakeDeps();
  const parent = deps.board.seed({ stage: 'in_progress', worktree_branch: 'auto/task-parent-1' });
  const elected = seedElected(deps, { parentTaskId: parent.id });

  await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.equal(deps.worktrees.ensured[0].baseBranch, 'auto/task-parent-1');
  assert.match(deps.prompts[0].prompt, /cut from auto\/task-parent-1/);
});

test('a subtask whose parent has a null worktree_branch falls back to auto/task-{parentId}', async () => {
  const deps = createFakeDeps();
  const parent = deps.board.seed({ stage: 'in_progress', worktree_branch: null });
  const elected = seedElected(deps, { parentTaskId: parent.id });

  await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.equal(deps.worktrees.ensured[0].baseBranch, `auto/task-${parent.id}`);
});

test('a subtask with upstream tasks lists their branches and titles in the prompt', async () => {
  const deps = createFakeDeps();
  const parent = deps.board.seed({ stage: 'in_progress', worktree_branch: 'auto/task-parent-1' });
  const upstream = deps.board.seed({
    stage: 'done',
    title: 'Add the imports table',
    worktree_branch: 'auto/task-upstream-1',
    parentTaskId: parent.id,
  });
  const elected = seedElected(deps, { parentTaskId: parent.id, dependsOn: [upstream.id] });

  await pickupTask(deps, actionConfig(), contextFor(elected));

  const prompt = deps.prompts[0].prompt;
  assert.match(prompt, /Merge them into your branch before you start/);
  assert.match(prompt, /auto\/task-upstream-1/);
  assert.match(prompt, /Add the imports table/);

  // The upstream task's title is untrusted text authored by whoever created
  // that other task, not an instruction for this agent — it must land inside
  // the fenced data block, not the branch list in the instruction section.
  const branchListLine = prompt.split('\n').find((line) => line.trim() === '- auto/task-upstream-1');
  assert.ok(branchListLine, 'the instruction section should list the bare branch, not "branch — title"');
  const fenceStart = prompt.indexOf('--- BEGIN BRANCH TASK DATA ---');
  const fenceEnd = prompt.indexOf('--- END BRANCH TASK DATA ---');
  assert.ok(fenceStart >= 0 && fenceEnd > fenceStart, 'expected a fenced branch-title data block');
  assert.ok(
    prompt.indexOf('Add the imports table') > fenceStart,
    'the untrusted title must land after the fence opens',
  );
  assert.ok(
    prompt.indexOf('Add the imports table') < fenceEnd,
    'the untrusted title must land before the fence closes',
  );
});

test('a subtask with no upstream tasks gets no merge-your-blockers paragraph', async () => {
  const deps = createFakeDeps();
  const parent = deps.board.seed({ stage: 'in_progress', worktree_branch: 'auto/task-parent-1' });
  const elected = seedElected(deps, { parentTaskId: parent.id });

  await pickupTask(deps, actionConfig(), contextFor(elected));

  assert.doesNotMatch(deps.prompts[0].prompt, /Merge them into your branch before you start/);
});

test("config.baseBranch is ignored for a subtask and honoured for a top-level ticket", async () => {
  const config = { projectPath: '/home/dev/my-app', baseBranch: 'main' };

  const subtaskDeps = createFakeDeps();
  const parent = subtaskDeps.board.seed({ stage: 'in_progress', worktree_branch: 'auto/task-parent-1' });
  const subtask = seedElected(subtaskDeps, { parentTaskId: parent.id });
  await pickupTask(subtaskDeps, config, contextFor(subtask));
  assert.equal(subtaskDeps.worktrees.ensured[0].baseBranch, 'auto/task-parent-1');

  const ticketDeps = createFakeDeps();
  const ticket = seedElected(ticketDeps);
  await pickupTask(ticketDeps, config, contextFor(ticket));
  assert.equal(ticketDeps.worktrees.ensured[0].baseBranch, 'main');
});
