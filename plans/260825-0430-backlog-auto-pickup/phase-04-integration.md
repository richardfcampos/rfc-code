# Phase D — Integration, build & smoke

## Context Links

- [phase-01](phase-01-trigger-and-contract.md) · [phase-02](phase-02-pickup-action.md) · [phase-03](phase-03-board-toggle.md)
- Spec: `docs/superpowers/specs/2026-08-25-backlog-auto-pickup-design.md`

## Overview

- **Priority:** P1
- **Status:** partial — build, typecheck, lint and the suites are green and the
  feature is deployed; the end-to-end smoke steps below are still unticked.
- **Effort:** 1h
- Verification only. This phase **owns no source files** — it builds, runs the suite
  and drives the loop by hand. Any defect it finds is fixed in the owning phase.

## Requirements

- Both TypeScript projects compile.
- The automations suite and the database migration test pass.
- A ticket created in the backlog reaches `in_progress` with a worktree, unattended.

## Dependencies

Blocked by A, B and C. **A and B must land together** — Phase A widens
`AutomationServiceDeps` with `board` and `worktrees`, and only Phase B binds them in
the composition root, so `build:server` is red between the two merges.

## Implementation Steps

1. **Build.**
   ```bash
   npm run build:server      # tsc -p server/tsconfig.json && tsc-alias
   npm run typecheck         # both tsconfig projects, client included
   npm run lint              # boundaries/dependencies must be clean
   ```
   `typecheck` covers the client, so no separate `npx tsc --noEmit` is needed —
   the root project is already in it.

2. **Test.**
   ```bash
   npm test
   # or, while iterating:
   npx tsx --tsconfig server/tsconfig.json --test "server/modules/automations/tests/*.test.ts"
   npx tsx --tsconfig server/tsconfig.json --test "server/modules/database/tests/*.test.ts"
   ```
   Confirm the pre-existing automations tests still pass unmodified — the contract
   changes are additive, so a diff there means something was widened wrongly.

3. **Upgrade check (the one that bites in production).** Start the server against a
   database created **before** this change — not a fresh one. Confirm the migration log
   line appears once, and that a second start does not repeat it. Then:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" localhost:PORT/api/automations
   ```
   should list existing rules with their history intact.

4. **Smoke — the full loop.**
   1. Open a project board, turn **Auto-pickup** on, set the limit to 1.
   2. `GET /api/automations` → exactly one rule named `board-auto-pickup:{projectId}`,
      `trigger_kind: task_backlog`, `action_kind: pickup_task`, `enabled: true`,
      `trigger_config.project` equal to the **projectId**.
   3. Create two backlog tickets.
   4. Wait for the minute tick. Expect: the **older** ticket moves to `in_progress`
      with `worktree_branch` set to `auto/task-{id}`; a worktree exists on disk; one
      session was created and is watchable in the UI. The second ticket stays in
      `backlog` — the limit of 1 is holding.
   5. `GET /api/automations/{id}/runs` → one `success` row whose detail names the session.
   6. Move the first ticket to `review`. Confirm the reviews module opens a review
      (existing behaviour, `reviews.module.ts` `onTaskStageChanged`) and that the next
      tick picks up the second ticket.
   7. Toggle auto-pickup **off**; create a third ticket; confirm nothing happens and the
      already-running agent is unaffected.

5. **Smoke — the failure paths.**
   - Point a rule's `action_config.projectPath` at a non-git directory. Expect three
     failed attempts in `/runs` with a readable git error, and the card still in `backlog`.
   - Move a ticket out of `backlog` by hand in the same minute it is elected. Expect a
     clean abort recorded in `/runs`, and the next tick electing the next ticket.
   - Confirm the queue is **not** starved: after a ticket fails all three attempts, the
     following tick picks up a *different* ticket rather than retrying the failed one
     forever. This is the highest-value assertion in this phase.

## Todo List

- [ ] `npm run build:server` clean
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm test` green, pre-existing automations tests unmodified
- [ ] Migration verified against a pre-change database, and idempotent on restart
- [ ] Full loop smoke passed
- [ ] Failure paths smoke passed, including the starvation check
- [ ] `Docs impact:` stated in the completion message

## Success Criteria

- Every checkbox above ticked.
- A ticket created on an enabled board reaches `in_progress` with a worktree and a live
  session, with no human action.
- The concurrency ceiling holds across several ticks.
- No regression in the existing automations, tasks or reviews suites.

## Risk Assessment

| Risk | L×I | Mitigation |
| --- | --- | --- |
| Only A or only B merged → red build | Med×Med | Land as one merge; stated in `plan.md` |
| Migration passes on a fresh DB but fails on a real one | Med×High | Step 3 tests an actual pre-change database, not a fresh one |
| Smoke needs a real model account | Med×Med | Any configured provider profile; failures are visible in `/runs` and are non-destructive |
| A minute of latency reads as "broken" | Med×Low | Expected by design — the spec chose the tick over a new emit path |

## Rollback

Revert B, then A, then C. Disable or delete any `board-auto-pickup:*` rule **before**
reverting the server phases: a stored `pickup_task` rule read by reverted code falls
through to `notify_push` (`automation-actions.service.ts:121`). Worktrees already
created are inert and removable through the existing worktrees UI. The widened SQL
CHECK is a superset and needs no down-migration.

## Next Steps

- `Docs impact:` the module README is updated in Phase A; confirm nothing else in
  `docs/` describes the automations trigger list.
- Consider a follow-up only if the smoke reveals it — nothing is planned beyond the spec.

## Unresolved Questions

None.
