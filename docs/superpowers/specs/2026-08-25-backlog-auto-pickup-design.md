# Backlog Auto-Pickup — Design

Date: 2026-08-25
Status: approved

## Problem

The task board is passive. Creating a ticket inserts a row and nothing else:
`emitTaskStageChanged` fires only from the update path in
`server/modules/tasks/tasks.service.ts`, no automation trigger watches the
backlog, and the live installation has zero automation rules. Tickets sit in
`backlog` until a human drags them or an already-running agent polls the board
through the bridge.

Desired model: the backlog is a work queue. When auto-pickup is enabled for a
project, the server drains it — picks the oldest ready ticket, gives it a
worktree, moves it to `in_progress`, and dispatches an agent. The agent
finishes by moving the card to `review`, where the existing reviews module
(`server/modules/reviews/reviews.module.ts`, `onTaskStageChanged`) already
opens a review for any card with a worktree.

## Decisions (user-confirmed)

| Decision | Choice |
| --- | --- |
| Trigger model | Auto-pickup from backlog (no manual drag gate) |
| Isolation | One worktree + branch per ticket |
| Concurrency | Configurable per project, numeric field, default 2, range 1–10 |
| Engine location | Inside the existing automations engine (new trigger + new action) |
| UI | Toggle + limit field on the board header; no generic rules screen (YAGNI) |
| Eligibility | Oldest `backlog` task whose dependencies are all `done` |
| Provider/profile | Resolved by the org policy engine, same path as `prompt_agent` |

## Architecture

```
ticket created (backlog)
  → minute tick (existing automation-scheduler.service)
  → trigger task_backlog evaluates per enabled rule
      concurrency: count(in_progress in project) >= maxConcurrent → skip
      elect: oldest backlog task with all dependencies done
      event identity: taskId + task.updated_at   (re-backlogged task can fire
                                                  again; same state never twice)
  → action pickup_task
      1. re-check the task is still in backlog (claim race → clean abort)
      2. create worktree + branch for the ticket (worktrees module)
      3. move card to in_progress, stamping worktree_branch on the task row
      4. dispatch agent via automation-agent-spawn.service (real session,
         org policy resolves the account profile)
  → agent works in the worktree, logs evidence via bridge tools
  → agent moves card to review → reviews module opens the review (existing)
```

### Trigger `task_backlog`

- Evaluated on the existing minute tick, alongside `cron` and
  `quota_threshold`; not event-driven, so ticket creation needs no new
  emit path.
- `trigger_config`: `{ "project": "<project_id>", "maxConcurrent": 2 }`.
  `project` required (rule is per-board), `maxConcurrent` integer 1–10.
- Elects at most one task per tick per rule — the concurrency check runs
  again next minute, which keeps the loop self-pacing without a queue.

### Action `pickup_task`

- Input: the elected task (from trigger context).
- Fails loudly into the engine's bounded retry (3 attempts, growing pause,
  every attempt recorded); the claim re-check makes retries safe.
- The dispatch prompt is built in (not a user template): task title,
  description, the worktree path/branch, and standing instructions — work
  only inside the worktree, log progress with `task_evidence_add`, move the
  card to `review` with `task_update_stage` when done.

### Board UI

- `AutoPickupToggle.tsx` in the board header
  (`src/components/task-board/view/TaskBoardTab.tsx`): a switch plus a
  numeric limit field (visible when enabled).
- Hook `useAutoPickup(projectId)`: finds/creates the single well-known rule
  `board-auto-pickup:{projectId}` through the existing `/api/automations`
  REST. Toggle maps to the rule's `enabled`; limit maps to
  `trigger_config.maxConcurrent`.
- Rule listing already exists (`GET /api/automations`); the hook filters by
  the name convention client-side. No new endpoints unless the list proves
  too coarse.

## Error handling

- Worktree creation or spawn failure → engine retry, history at
  `GET /api/automations/:id/runs`.
- Claim race (card moved between election and action) → silent abort; next
  tick elects the next ticket.
- Toggle off → rule disabled; agents already running are unaffected.
- Engine failure never blocks the rest of the app (existing
  `startAutomations` never-throw contract).

## Testing

- Trigger: concurrency gate, oldest-first ordering, dependency filtering,
  event-identity dedupe (same state never fires twice, re-backlog fires
  again).
- Action: claim-race abort, worktree failure surfaces as failed attempt,
  successful pickup stamps `worktree_branch` and dispatches once.
- Validation: `task_backlog` and `pickup_task` config shapes, bounds on
  `maxConcurrent`.
- UI: hook upsert behavior (create on first enable, patch thereafter).

## Files

Server (~6 touched + 1 new):
- `server/modules/automations/automations.types.ts` — new trigger/action kinds
- `server/modules/automations/automations.validation.ts` — config validation
- `server/modules/automations/services/automation-triggers.service.ts` — tick evaluation
- `server/modules/automations/services/automation-actions.service.ts` — action dispatch
- `server/modules/automations/services/task-pickup.service.ts` — new: claim + worktree + move + spawn
- `server/modules/automations/automations.module.ts` — wire task/worktree deps
- tests under `server/modules/automations/tests/`

Frontend (~3):
- `src/components/task-board/view/AutoPickupToggle.tsx` — new
- `src/components/task-board/view/TaskBoardTab.tsx` — mount the toggle
- `src/components/task-board/hooks/use-auto-pickup.ts` — new

## Extension: orchestrator pickup (approved 2026-08-25, second pass)

The solo pipeline above shipped first. The approved follow-up turns the
picked-up agent into a conditional orchestrator:

- The pickup prompt tells the agent: a large/multi-part ticket is decomposed
  with the bundled `maestro` skill via the bridge's `task_decompose` (the
  subtasks land in `backlog` and the existing election drains them in
  dependency order); a small ticket is executed directly, as today. The
  judgment stays with the agent — no size heuristic in code.
- A decomposing parent logs its plan as evidence and exits without moving
  its card. Delegation stays with auto-pickup, not `task_delegate`.
- Integration (user-chosen): the parent integrates at the end. Subtask
  worktrees branch from the parent's branch (`auto/task-{parentId}`), not
  from the project base. When all subtasks are `done`, the tick re-dispatches
  the parent with an integration prompt: merge the subtask branches into its
  own, resolve conflicts, move the parent card to `review`. One consolidated
  review.
- Open lifecycle details (parent slot accounting against `maxConcurrent`,
  re-wake election + dedupe identity, child base-branch plumbing) are
  resolved in the implementation plan, phases 05+.

Closing the loop (approved, same second pass) — the human gate lives at
review approval:

- First-pass reviewer: a card landing in `review` gets an agent reviewer
  that reads the branch diff and leaves comments through the existing
  reviews module; the author agent addresses them. The engine's
  `task_stage` trigger machinery is the natural carrier.
- The user gives the final approval in the Review Center — the one human
  action per ticket.
- Merge-on-approve: an approved review merges the task's branch into the
  project base branch and moves the card to `done`. A merge conflict or
  failed merge surfaces on the card instead of completing silently.
  `done` then means integrated, not just finished.

## Out of scope

- Generic automation rules screen.
- New emit on task creation (minute tick covers pickup latency).
- Attachment-aware prompts, multi-provider selection UI, cross-project rules.
