# Phase B — Action `pickup_task` & composition wiring

## Context Links

- Spec (authoritative): `docs/superpowers/specs/2026-08-25-backlog-auto-pickup-design.md`
- **Contract this phase codes against:** [phase-01 §Contract](phase-01-trigger-and-contract.md#contract-shared-with-phase-b)
- Action contract: `server/modules/automations/README.md:97-105`

## Overview

- **Priority:** P1
- **Status:** pending
- **Effort:** 4h
- Turn an elected ticket into running work: re-check the claim, get a worktree,
  move the card and stamp its branch, dispatch an agent.

Runs **in parallel with Phase A**. This phase writes **no type declarations** — every
type it uses is declared by Phase A. If something is missing, ask Phase A to add it;
do not edit `automations.types.ts`.

## Key Insights

1. **The action dispatcher falls through.** `executeAutomationAction`
   (`automation-actions.service.ts:108-122`) checks `prompt_agent`, then `create_task`,
   then `return runNotifyPush(...)` **unconditionally** at `:121`. A new kind added
   without an explicit branch silently sends a push notification instead of picking
   up the task — and the history would record success. The `pickup_task` branch must
   be added *before* that fallthrough, and a test must assert it.

2. **An action has exactly two outcomes:** return a detail string (recorded `success`)
   or throw (recorded `failed`, retried up to 3× — `automations.service.ts:145-171`).
   There is no `skipped` at the action layer. The spec's "silent abort" on a claim
   race therefore has to be a **return**, not a throw — throwing would burn three
   retries on a card someone else already took.

3. **Retries re-enter a partially completed action.** `createWorktree` is not
   idempotent: an existing branch that is already checked out throws
   `BRANCH_ALREADY_CHECKED_OUT` (409, `worktree-create.service.ts:56`) and an existing
   folder throws `WORKTREE_FOLDER_EXISTS` (409, `:72`). If attempt 1 creates the
   worktree and then fails at dispatch, attempts 2 and 3 would fail at worktree
   creation and the ticket would end up failed-but-half-done. Both re-entry points
   must be made resumable — see steps 3 and 4.

4. **Cross-module imports must go through the barrel.** `eslint.config.js:230-233`
   makes a deep import into another module a lint **error**. So `task-pickup.service.ts`
   imports nothing cross-module: it takes the injected ports Phase A declared, and
   `automations.module.ts` does the real binding. That is also the existing house
   pattern (`automations.module.ts:61-97`).

5. **`createWorktree` is not exported from the worktrees barrel.** `worktrees/index.ts`
   currently exports only `worktreesRoutes`, `findWorktreeEntryByPath`,
   `listWorktreePorcelainEntries`, `validateWorktreeBranchName`, `mergeWorktree`,
   `removeWorktree`. This phase adds `createWorktree` to it. The precedent for a
   module consuming worktrees this way is `reviews.module.ts:18-59`: import the bare
   workflow function from the barrel, re-bind it with `runGitCommand` from
   `@/shared/git-command.js` in your own composition root.

6. **Moving the card re-enters the automations engine.** `tasksService.updateTask`
   emits a stage change (`tasks.service.ts:207-212`) and `automations.module.ts:124-126`
   is subscribed to it. Moving to `in_progress` will therefore evaluate the user's
   `task_stage` rules. This is correct and pre-existing; it cannot loop back into
   `task_backlog`, which is tick-only.

## Requirements

**Functional**
- `pickup_task` re-checks that the elected task is still claimable and aborts cleanly (no retry, no side effect) when it is not.
- One worktree + branch per ticket, reused rather than re-created when it already exists.
- The card moves to `in_progress` with `worktree_branch` stamped in a single write, and the board is broadcast.
- An agent is dispatched exactly once per successful pickup, through the existing spawn gateway so the org policy resolves the account.
- The prompt is built in code (not a user template) and carries: title, description, worktree path, branch, and the standing instructions from the spec.

**Non-functional**
- `task-pickup.service.ts` under 200 lines.
- Failures throw with a message worth reading in `GET /api/automations/:id/runs`.
- No new REST endpoints.

## Related Code Files

**Create**
- `server/modules/automations/services/task-pickup.service.ts`
- `server/modules/automations/tests/task-pickup.service.test.ts`

**Modify**
- `server/modules/automations/services/automation-actions.service.ts` — the `pickup_task` branch
- `server/modules/automations/automations.module.ts` — bind `board` + `worktrees`
- `server/modules/worktrees/index.ts` — export `createWorktree`
- `server/modules/automations/tests/automation-actions.test.ts` — dispatcher coverage

**Do not touch** — `automations.types.ts`, `automations.validation.ts`,
`automation-triggers.service.ts`, `tests/support/fake-automation-deps.ts` (all Phase A).

## Implementation Steps

1. **Export the create API.** In `server/modules/worktrees/index.ts`, add
   `export { createWorktree } from './services/worktree-create.service.js';`
   next to the `mergeWorktree`/`removeWorktree` exports. Use plain `createWorktree`,
   **not** `createAndOpenWorktree` — auto-pickup needs a git worktree, not a
   registered CloudCLI project, and `createAndOpen` drags in `openWorktree` plus a
   `WorktreeProjectGateway` for no benefit here.

2. **Write `task-pickup.service.ts`.** One exported async function matching the shape
   the other actions use (return the history detail, throw on failure — the retry
   policy lives above it):

   ```ts
   export async function pickupTask(
     deps: AutomationServiceDeps,
     config: PickupTaskActionConfig,
     context: AutomationTriggerContext,
   ): Promise<string>
   ```

   Body, in order:

3. **Read the elected task and re-check the claim.**
   - `const elected = context.task;` — throw `AutomationValidationError` when absent
     (a `pickup_task` action wired to a trigger that elects nothing is a misconfiguration).
   - `const current = deps.board.getTask(elected.id);`
   - Compute the branch first (step 4) so the re-check can recognise its own work.
   - Claimable when `current` exists and either:
     - `current.stage === 'backlog'` — a fresh pickup; or
     - `current.stage === 'in_progress' && current.worktree_branch === branch` — a
       **retry of this same firing** that already got as far as moving the card.
       Accepting this is what makes attempts 2 and 3 resume instead of abort, and it
       is what the spec means by "the claim re-check makes retries safe".
   - Anything else (task deleted, moved to `review`/`done`, or in `in_progress` under
     a different branch) → `return` a detail like
     `Task ${elected.id} was no longer in backlog; nothing to pick up`. Return, never
     throw: this is the clean abort, and the next tick elects the next ticket.

4. **Resolve the branch, then the worktree.**
   - Branch name: `auto/task-${elected.id}`. Deterministic (so a retry addresses the
     same worktree) and made of characters `validateWorktreeBranchName`
     (`worktree-git.service.ts:13`) accepts. **Do not derive it from the task title** —
     there is no slugifier in the codebase and titles carry arbitrary characters.
   - `const { worktreePath } = await deps.worktrees.ensureWorktree({ projectPath: config.projectPath, branch, baseBranch: config.baseBranch ?? null });`
     Reuse-or-create lives behind the port (step 6), so this call is safe to repeat.

5. **Move, then dispatch.**
   - `await deps.board.moveToInProgress(elected.id, branch)` — one write for stage +
     branch, then broadcast (both inside the port).
   - Build the prompt in code. Include: `elected.title`, `elected.description`, the
     worktree path and branch, and the standing instructions — work only inside the
     worktree, log progress with `task_evidence_add`, move the card to `review` with
     `task_update_stage` when done.
   - `const result = await deps.agent.promptAgent({ projectPath: config.projectPath,
     provider: config.provider ?? 'claude', prompt, requestedProfileId: config.profileId ?? null,
     worktreePath, worktreeBranch: branch });`
   - Return `Picked up task ${elected.id} on ${branch} in session ${result.sessionId}`.

6. **Wire the composition root** (`automations.module.ts`). Extend the `deps` literal
   at `:61-97` — do not restructure it. Imports to add: `tasksDb`, `taskDependenciesDb`
   from `@/modules/database/index.js` (line 16 already imports from that barrel);
   `createWorktree`, `listWorktreePorcelainEntries` from `@/modules/worktrees/index.js`;
   `runGitCommand` from `@/shared/git-command.js` (import it from `@/shared`, not
   through the worktrees barrel — `reviews.module.ts:20` does exactly this to keep the
   worktrees HTTP module out of the import graph); `access` from `node:fs/promises`.

   ```ts
   board: {
     listReadyBacklog: (project) => taskDependenciesDb.listReadyBacklogByProject(project),
     countInProgress: (project) => tasksDb.countByStage(project, 'in_progress'),
     getTask: (taskId) => tasksDb.get(taskId),
     // Same reason `createTask` broadcasts: a card the server moves has to reach
     // open boards exactly like one moved through the REST API.
     moveToInProgress: async (taskId, worktreeBranch) => {
       const task = await tasksService.updateTask(taskId, {
         stage: 'in_progress',
         worktree_branch: worktreeBranch,
       });
       broadcastTaskUpdate(task, 'updated');
       return task;
     },
   },
   worktrees: {
     ensureWorktree: async ({ projectPath, branch, baseBranch }) => {
       // Reuse before create: a retried pickup must not trip over the worktree
       // its own previous attempt left behind.
       const entries = await listWorktreePorcelainEntries(projectPath, runGitCommand);
       const existing = entries.find((entry) => entry.branch === branch);
       if (existing) return { worktreePath: existing.path, branch };

       const created = await createWorktree(
         { projectPath, branch, baseBranch },
         { runGit: runGitCommand, fileSystem: { pathExists: async (p) => access(p).then(() => true, () => false) } },
       );
       return { worktreePath: created.worktreePath, branch: created.branch };
     },
   },
   ```

   Verified signatures: `tasksDb.get(id): TaskRow | null` (`tasks.db.ts:109`),
   `listWorktreePorcelainEntries(projectPath, runGit)` (`worktree-git.service.ts:102-105`),
   `createWorktree(input, { runGit, fileSystem })` → `{ worktreePath, branch, createdBranch }`
   (`worktree-create.service.ts:41`, result type at `shared/types.ts:706`).
   `tasksService.updateTask` accepts `stage` and `worktree_branch` in one body
   (`tasks.service.ts:182-200`). The `pathExists` adapter mirrors
   `worktrees.module.ts:30-39`, which is not exported.

7. **Dispatch the action.** In `automation-actions.service.ts`, add **before** the
   `return runNotifyPush(...)` fallthrough at `:121`:
   ```ts
   if (automation.action_kind === 'pickup_task') {
     return pickupTask(deps, config as unknown as PickupTaskActionConfig, context);
   }
   ```
   Import `pickupTask` from `./task-pickup.service.js` and the config type from
   `../automations.types.js`, following the existing import grouping at `:9-22`.

## Todo List

- [ ] `createWorktree` exported from the worktrees barrel
- [ ] `task-pickup.service.ts` created
- [ ] Claim re-check accepts fresh pickup **and** same-branch retry
- [ ] Branch is `auto/task-{id}`, worktree reused when present
- [ ] Single write moves stage + stamps branch, then broadcasts
- [ ] Built-in prompt carries title, description, worktree, branch, standing instructions
- [ ] `pickup_task` branch added **before** the `notify_push` fallthrough
- [ ] `board` + `worktrees` bound in `automations.module.ts`
- [ ] Tests below green

## Test Matrix

`tests/task-pickup.service.test.ts` (new — node:test + `assert/strict`, using
`createFakeDeps` from `./support/fake-automation-deps.js` as every sibling does):

- happy path: worktree created, task moved to `in_progress` with `worktree_branch` stamped, agent prompted **once**, detail names the session
- claim race — task now in `review`: returns without creating a worktree, moving anything, or prompting
- claim race — task deleted (`getTask` → null): same clean abort
- retry resume — task already `in_progress` on the same branch: does **not** abort; proceeds to dispatch
- retry resume — task `in_progress` on a *different* branch: aborts
- worktree reuse: an existing entry for the branch is returned, `createWorktree` never called
- worktree failure throws → surfaces as a failed attempt (assert via the firing service, which retries 3×)
- spawn failure throws after the move → the card stays `in_progress` and the next attempt resumes
- the prompt contains the worktree path, the branch and the `task_update_stage` instruction

`tests/automation-actions.test.ts` (extend):
- **a `pickup_task` rule does not send a push notification** — the regression guard for the `:121` fallthrough
- `pickup_task` reaches `pickupTask` with the parsed config

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/automations/tests/*.test.ts`

## Success Criteria

- `npm run build:server` clean (with Phase A merged).
- Every test above passes; the existing automations suite is untouched and green.
- `npm run lint` reports no `boundaries/dependencies` error — proof the barrel route was used.
- A firing with a seeded backlog task ends with: worktree on disk, card in `in_progress` carrying its branch, one session created.

## Risk Assessment

| Risk | L×I | Mitigation |
| --- | --- | --- |
| New kind silently runs `notify_push` | High×High | Explicit branch before `:121` + a dedicated regression test |
| Retry fails on an existing worktree | High×Med | `ensureWorktree` reuses; claim re-check accepts the same-branch resume |
| Card left `in_progress` with no agent after 3 failed dispatches | Med×Med | Visible in `GET /api/automations/:id/runs`; the card is un-stuck by moving it back to `backlog`, which mints a new dedupe identity |
| Worktrees barrel import closes a cycle | Low×Med | `reviews.module.ts` already imports that barrel from a composition root; fallback is a direct service-file import, which the barrel comment at `worktrees/index.ts:16-19` explicitly sanctions |
| Clean abort recorded as `success` | Med×Low | Detail string states plainly that nothing was picked up; the engine has no action-level `skipped` |

## Security Considerations

- `config.projectPath` reaches `git worktree add` via `runGitCommand`, which uses
  `cross-spawn` with `shell: false` (`shared/git-command.ts:18`) — no shell injection.
- Branch names are derived from a server-generated task id, never from user text.
- The account is resolved by the org policy engine inside the spawn gateway
  (`automation-agent-spawn.service.ts:85-116`); `profileId` may narrow, never grant.

## Rollback

Revert the commit. Rules of kind `pickup_task` would then fail validation on write and
fall through to `notify_push` on read — so disable or delete any auto-pickup rule
*before* reverting. Worktrees already created are inert and removable through the
existing worktrees UI.

## Next Steps

Phase D builds and smoke-tests. No frontend dependency.

## Unresolved Questions

None. The prompt's exact wording is left to implementation, bounded by the content
list in step 5.
