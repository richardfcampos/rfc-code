---
title: "Backlog Auto-Pickup"
description: "Server drains the backlog: a minute-tick trigger elects the oldest ready ticket, gives it a worktree, moves it to in_progress and dispatches an agent."
status: pending
priority: P2
effort: 11h
branch: feat/agent-orchestration-phase2
tags: [automations, task-board, worktrees, orchestration]
created: 2026-08-25
---

# Backlog Auto-Pickup

Implements `docs/superpowers/specs/2026-08-25-backlog-auto-pickup-design.md` (approved, final).
New automation trigger `task_backlog` + new action `pickup_task`, plus a board-header toggle.

## Phases

| # | Phase | Owns | Depends on | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| A | [Trigger & election contract](phase-01-trigger-and-contract.md) | `automations.types.ts`, `automations.validation.ts`, `automation-triggers.service.ts`, DB kind unions + schema + migration, `tasks.db.ts`, `task-dependencies.db.ts`, `tests/support/fake-automation-deps.ts` | — | 4h | pending |
| B | [Pickup action & wiring](phase-02-pickup-action.md) | `automation-actions.service.ts`, `task-pickup.service.ts` (new), `automations.module.ts`, `worktrees/index.ts` | A's contract (declared, not merged) | 4h | pending |
| C | [Board toggle](phase-03-board-toggle.md) | `AutoPickupToggle.tsx` (new), `use-auto-pickup.ts` (new), `TaskBoardTab.tsx` | REST contract only | 2h | pending |
| D | [Integration & smoke](phase-04-integration.md) | nothing (verification only) | A + B + C | 1h | pending |

## Parallelism

A, B and C are developed **in parallel** — no two phases write the same file.
The seam between A and B is the type contract in
[phase-01 §Contract](phase-01-trigger-and-contract.md#contract-shared-with-phase-b):
Phase A writes **every** type declaration both phases consume; Phase B only
implements against them. C depends on neither — it talks to the existing
`/api/automations` REST and the rule-name convention `board-auto-pickup:{projectId}`.

**Merge order is A → B → C → D.** A and B are parallel-developable but *not*
independently shippable: A widens `AutomationServiceDeps` with ports that only B
binds in the composition root, so `npm run build:server` is red between the two.
Land them as one merge, or land A and B back to back before running D.

## Key decisions carried from the spec

- Evaluated on the existing minute tick — no new emit on task creation.
- Elects **at most one task per tick per rule**; the concurrency check re-runs next minute.
- `maxConcurrent` integer 1–10, default 2; counts **all** `in_progress` tasks in the project.
- Event identity for dedupe: `taskId` + `task.updated_at`.
- One worktree + branch per ticket; provider/profile resolved by the org policy engine.

## Findings that changed the file list

The spec's Files section lists 6 server files + 1 new. Three more are required and
are **not** design changes — they are what the codebase makes necessary:

1. **`AutomationTriggerKind` / `AutomationActionKind` live in the database module**
   (`repositories/automations.db.ts:13-14`), not in `automations.types.ts`.
2. **A SQL `CHECK` constraint pins both kind lists** (`schema.ts:432-439`). SQLite
   cannot alter a CHECK, and `CREATE TABLE IF NOT EXISTS` means existing installs
   keep the narrow one — a table-rebuild migration is mandatory or every
   `task_backlog` insert fails with `SQLITE_CONSTRAINT_CHECK`.
3. **Neither election query exists.** `taskDependenciesDb.listReady` is scoped to a
   single `parent_task_id`, not a project, and nothing anywhere counts tasks by
   stage. Both are new queries.

See [phase-01](phase-01-trigger-and-contract.md#key-insights) for citations.

## Risks

| Risk | Phase | L×I | Mitigation |
| --- | --- | --- | --- |
| Failed pickup permanently starves the queue (head-of-line block) | A | High×High | Election skips candidates that already have history for their dedupe key — [phase-01 step 5](phase-01-trigger-and-contract.md#implementation-steps) |
| New action kind silently runs `notify_push` (fallthrough at `automation-actions.service.ts:121`) | B | High×High | Explicit `pickup_task` branch **before** the fallthrough + a test asserting it |
| Retry re-creates an existing worktree → 409, all 3 attempts fail | B | High×Med | Reuse an existing worktree for the branch instead of creating — [phase-02 step 4](phase-02-pickup-action.md#implementation-steps) |
| Migration drops `automations` with FK children | A | Low×High | `PRAGMA foreign_keys = OFF` + explicit transaction, per the house rebuild pattern |
| Worktrees barrel import closes a cycle | B | Low×Med | Mirror `reviews.module.ts`; fallback is a direct service-file import |

## Unresolved questions

Listed at the end of [phase-01](phase-01-trigger-and-contract.md#unresolved-questions)
and [phase-03](phase-03-board-toggle.md#unresolved-questions).
