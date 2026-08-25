import assert from 'node:assert/strict';
import test from 'node:test';

import type { AutomationTriggerContext } from '@/modules/automations/automations.types.js';
import { integrateParentTask } from '@/modules/automations/services/task-integration.service.js';

import { createFakeDeps, type FakeBoardTaskSeed } from './support/fake-automation-deps.js';

function contextFor(task: ReturnType<typeof seedParent>): AutomationTriggerContext {
  return { dedupeKey: null, variables: {}, task, intent: 'integrate' };
}

function seedParent(deps: ReturnType<typeof createFakeDeps>, overrides: FakeBoardTaskSeed = {}) {
  return deps.board.seed({
    stage: 'in_progress',
    title: 'Ship the board',
    worktree_branch: 'auto/task-parent-1',
    ...overrides,
  });
}

function actionConfig(): { projectPath: string } {
  return { projectPath: '/home/dev/my-app' };
}

test('happy path: dispatches once, moves no card, names every child branch in the prompt', async () => {
  const deps = createFakeDeps();
  const parent = seedParent(deps);
  deps.board.seed({ stage: 'done', title: 'Schema', worktree_branch: 'auto/task-child-1', parentTaskId: parent.id });
  deps.board.seed({ stage: 'done', title: 'API', worktree_branch: 'auto/task-child-2', parentTaskId: parent.id });

  const detail = await integrateParentTask(deps, actionConfig(), contextFor(parent));

  assert.equal(deps.prompts.length, 1);
  assert.equal(deps.prompts[0].worktreeBranch, 'auto/task-parent-1');
  assert.equal(deps.board.moved.length, 0);
  assert.equal(deps.board.getTask(parent.id)?.stage, 'in_progress');

  const prompt = deps.prompts[0].prompt;
  assert.match(prompt, /auto\/task-child-1/);
  assert.match(prompt, /Schema/);
  assert.match(prompt, /auto\/task-child-2/);
  assert.match(prompt, /API/);
  assert.match(prompt, /move the card to review with the task_update_stage tool/);

  // Child titles are text authored by whoever created those subtasks, not
  // instructions for the integrating agent — the merge list in the
  // instruction section names bare branches, and the titles land in a fenced
  // data block instead.
  const mergeListLine = prompt.split('\n').find((line) => line.trim() === '- auto/task-child-1');
  assert.ok(mergeListLine, 'the merge instructions should list the bare branch, not "branch — title"');
  const fenceStart = prompt.indexOf('--- BEGIN BRANCH TASK DATA ---');
  const fenceEnd = prompt.indexOf('--- END BRANCH TASK DATA ---');
  assert.ok(fenceStart >= 0 && fenceEnd > fenceStart, 'expected a fenced branch-title data block');
  assert.ok(prompt.indexOf('Schema') > fenceStart && prompt.indexOf('Schema') < fenceEnd);
  assert.ok(prompt.indexOf('API') > fenceStart && prompt.indexOf('API') < fenceEnd);

  assert.equal(detail, `Integrated 2 subtasks of ${parent.id} on auto/task-parent-1 in session session-1`);
});

test('a parent no longer in_progress is a clean abort with no dispatch, reported unrecorded', async () => {
  const deps = createFakeDeps();
  const parent = seedParent(deps, { stage: 'review' });
  deps.board.seed({ stage: 'done', worktree_branch: 'auto/task-child-1', parentTaskId: parent.id });

  const outcome = await integrateParentTask(deps, actionConfig(), contextFor(parent));

  // Unrecorded: the completed-child-set dedupe key this firing carries did
  // not change just because the parent moved on before this attempt
  // re-checked it, so a recorded row would block that same completed set
  // from ever being integrated.
  assert.ok(typeof outcome !== 'string', 'expected an unrecorded skip, not a recorded detail');
  assert.match(outcome.detail, /no longer in_progress/);
  assert.equal(deps.prompts.length, 0);
  assert.equal(deps.worktrees.ensured.length, 0);
});

test('a child no longer done is a clean abort', async () => {
  const deps = createFakeDeps();
  const parent = seedParent(deps);
  deps.board.seed({ stage: 'done', worktree_branch: 'auto/task-child-1', parentTaskId: parent.id });
  deps.board.seed({ stage: 'in_progress', worktree_branch: 'auto/task-child-2', parentTaskId: parent.id });

  const outcome = await integrateParentTask(deps, actionConfig(), contextFor(parent));

  // Recorded normally: an unfinished child set is already a different dedupe
  // key (its fingerprint includes `updated_at`), so remembering this stale
  // one loses nothing.
  assert.ok(typeof outcome === 'string', 'expected a recorded detail, not an unrecorded skip');
  assert.match(outcome, /subtasks changed since election/);
  assert.equal(deps.prompts.length, 0);
});

test('a parent with no subtasks at all is a clean abort', async () => {
  const deps = createFakeDeps();
  const parent = seedParent(deps);

  const outcome = await integrateParentTask(deps, actionConfig(), contextFor(parent));

  assert.ok(typeof outcome === 'string', 'expected a recorded detail, not an unrecorded skip');
  assert.match(outcome, /subtasks changed since election/);
  assert.equal(deps.prompts.length, 0);
});

test('a live session on the parent branch is a clean abort, reported unrecorded', async () => {
  const deps = createFakeDeps({
    agent: {
      promptAgent: async () => {
        throw new Error('must not dispatch while a live session already owns the branch');
      },
      hasLiveSessionForBranch: () => true,
    },
  });
  const parent = seedParent(deps);
  deps.board.seed({ stage: 'done', worktree_branch: 'auto/task-child-1', parentTaskId: parent.id });

  const outcome = await integrateParentTask(deps, actionConfig(), contextFor(parent));

  assert.ok(typeof outcome !== 'string', 'expected an unrecorded skip, not a recorded detail');
  assert.match(outcome.detail, /already has a live agent session/);
  assert.equal(deps.worktrees.ensured.length, 0);
});

test('a promptAgent failure throws and does not revert the card', async () => {
  const deps = createFakeDeps({
    agent: {
      promptAgent: async () => {
        throw new Error('spawn unavailable');
      },
      hasLiveSessionForBranch: () => false,
    },
  });
  const parent = seedParent(deps);
  deps.board.seed({ stage: 'done', worktree_branch: 'auto/task-child-1', parentTaskId: parent.id });

  await assert.rejects(() => integrateParentTask(deps, actionConfig(), contextFor(parent)), /spawn unavailable/);

  assert.equal(deps.board.getTask(parent.id)?.stage, 'in_progress');
  assert.deepEqual(deps.board.reverted, []);
});

test('a parent whose worktree_branch is null falls back to auto/task-{parentId}', async () => {
  const deps = createFakeDeps();
  const parent = seedParent(deps, { worktree_branch: null });
  deps.board.seed({ stage: 'done', worktree_branch: 'auto/task-child-1', parentTaskId: parent.id });

  await integrateParentTask(deps, actionConfig(), contextFor(parent));

  assert.equal(deps.worktrees.ensured[0].branch, `auto/task-${parent.id}`);
});

test('integrateParentTask throws when fired with no elected task in context', async () => {
  const deps = createFakeDeps();
  await assert.rejects(
    () => integrateParentTask(deps, actionConfig(), { dedupeKey: null, variables: {}, intent: 'integrate' }),
    /no elected task/,
  );
});
