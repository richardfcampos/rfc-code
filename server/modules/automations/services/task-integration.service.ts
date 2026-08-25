/**
 * Runs the integrate half of the backlog loop: a decomposed parent whose
 * subtasks are all `done` is re-dispatched to merge every child branch into
 * its own and move itself to `review` — the one consolidated review this
 * flow produces. No card move happens here for a fresh pickup: the parent is
 * already `in_progress`, and only the integrating agent moves it onward.
 */

import { AutomationValidationError } from '../automations.errors.js';
import type {
  AutomationActionResult,
  AutomationServiceDeps,
  AutomationTriggerContext,
  PickupTaskActionConfig,
} from '../automations.types.js';
import { unrecordedSkip } from '../automations.types.js';

import { DATA_WARNING, branchForTask, formatBranchTitleData, formatTaskData } from './task-pickup.service.js';

const DEFAULT_PROVIDER = 'claude' as const;

/** Every branch merged into the parent's own, named for the agent, with the parent's own text fenced as data. */
function buildIntegrationPrompt(input: {
  title: string;
  description: string | null;
  worktreePath: string;
  branch: string;
  children: { branch: string; title: string }[];
}): string {
  const { title, description, worktreePath, branch, children } = input;
  const taskData = formatTaskData(title, description);

  return [
    'Every subtask of the ticket below is finished. Your job is to integrate them — not to write new features and not to redesign what the subtasks did.',
    `Work only inside the worktree at ${worktreePath} (branch ${branch}) — do not touch the main checkout.`,
    [
      `Merge each of these branches into ${branch}, in the order listed, resolving conflicts as you go:`,
      ...children.map((child) => `- ${child.branch}`),
    ].join('\n'),
    formatBranchTitleData(children),
    'After each merge, check the project still builds and its tests still pass. Fix what the merge broke, and nothing else.',
    'When every branch is merged and the result is sound, log a short summary with the task_evidence_add tool and move the card to review with the task_update_stage tool. A human reviews the whole thing once, here — this is the only review this work gets.',
    'If a conflict is beyond you, stop: log what is wrong with task_evidence_add and leave the card where it is. Do not move it to review with the merge unfinished.',
    'Once a branch is merged you may remove its worktree with `git worktree remove`. Leave it in place if the command refuses.',
    DATA_WARNING,
    '--- BEGIN TASK DATA ---',
    taskData,
    '--- END TASK DATA ---',
  ].join('\n\n');
}

/**
 * Runs one attempt of the `integrate` intent. Returns the history detail;
 * throws on failure. Unlike `pickupTask`, a dispatch failure here is never
 * reverted: the parent stays exactly where it is and the throw is recorded —
 * reverting it would only re-elect it as a fresh pickup and decompose the
 * same ticket a second time.
 *
 * The "no longer in_progress" and "live session on the branch" skips below
 * are reported unrecorded: this firing's dedupe key is the parent's exact
 * completed child set (id, count, newest `updated_at`), and it does not
 * change just because this attempt happened to lose the race — recording it
 * anyway would block that same completed set from ever being integrated. The
 * "subtasks changed" skip a few lines down keeps recording normally: a
 * changed set is a different dedupe key already, so nothing is lost by
 * remembering the stale one.
 */
export async function integrateParentTask(
  deps: AutomationServiceDeps,
  config: PickupTaskActionConfig,
  context: AutomationTriggerContext,
): Promise<AutomationActionResult> {
  const parent = context.task;
  if (!parent) {
    throw new AutomationValidationError('pickup_task fired with intent "integrate" but no elected task in its context');
  }

  const current = deps.board.getTask(parent.id);
  if (!current || current.stage !== 'in_progress') {
    return unrecordedSkip(`Task ${parent.id} is no longer in_progress; nothing to integrate`);
  }

  const children = deps.board.listSubtasks(parent.id);
  if (children.length === 0 || children.some((child) => child.stage !== 'done')) {
    return `Task ${parent.id}'s subtasks changed since election; nothing to integrate`;
  }

  const branch = current.worktree_branch ?? branchForTask(parent.id);

  // The parent's own decomposing run, or an earlier integration attempt,
  // must not be joined by a second agent on the same branch.
  if (deps.agent.hasLiveSessionForBranch(branch)) {
    return unrecordedSkip(
      `Task ${parent.id} already has a live agent session on ${branch}; skipping to avoid a second agent joining the same worktree`,
    );
  }

  // Reuse hits the parent's existing worktree; baseBranch is only a fallback
  // for one that was pruned out from under it.
  const { worktreePath } = await deps.worktrees.ensureWorktree({
    projectPath: config.projectPath,
    branch,
    baseBranch: config.baseBranch ?? null,
  });

  const prompt = buildIntegrationPrompt({
    title: current.title,
    description: current.description,
    worktreePath,
    branch,
    children: children.map((child) => ({
      branch: child.worktree_branch ?? branchForTask(child.id),
      title: child.title,
    })),
  });

  const result = await deps.agent.promptAgent({
    projectPath: config.projectPath,
    provider: config.provider ?? DEFAULT_PROVIDER,
    prompt,
    requestedProfileId: config.profileId ?? null,
    worktreePath,
    worktreeBranch: branch,
  });

  return `Integrated ${children.length} subtasks of ${parent.id} on ${branch} in session ${result.sessionId}`;
}
