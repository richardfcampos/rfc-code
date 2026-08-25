# Phase E — Parent lifecycle & the integration election

## Context Links

- Base feature: [phase-01](phase-01-trigger-and-contract.md) · [phase-02](phase-02-pickup-action.md) · [phase-04](phase-04-integration.md)
- Sibling: [phase-06](phase-06-orchestrator-prompts-and-integration.md) (consumes this phase's contract)
- Spec: `docs/superpowers/specs/2026-08-25-backlog-auto-pickup-design.md`
- Maestro skill: `skills/maestro/SKILL.md`

## Overview

- **Priority:** P1
- **Status:** pending
- **Effort:** 4h
- Teaches the loop that a ticket can become a *plan*: a parent that decomposed
  stops occupying a slot while its children run, and comes back on the same tick
  once every child is done.

## Key Insights (verified)

1. **No schema change, no migration, no new action kind.** The parent/child
   column (`schema.ts:356`) and its index (`migrations.ts:833`) already exist,
   and the integration re-wake reuses the `task_backlog` trigger and the
   `pickup_task` action already in the SQL `CHECK`. Nothing in this phase touches
   `schema.ts`, `migrations.ts` or `automations.validation.ts`.

2. **The concurrency gate reads a raw count today.**
   `automation-triggers.service.ts:170` calls `deps.board.countInProgress`, bound
   at `automations.module.ts:116` to `tasksDb.countByStage(project, 'in_progress')`
   (`tasks.db.ts:111-117`) — a flat `COUNT(*)`. A decomposed parent sits in
   `in_progress` with no agent attached, so with `maxConcurrent: 2` a single
   decomposition permanently spends half the ceiling on a card that is doing
   nothing, and with `maxConcurrent: 1` it deadlocks its own subtasks.

3. **`TaskRow` has no `parent_task_id`.** `TASK_COLUMNS` (`tasks.db.ts:55-56`)
   omits it; only `SubtaskRow` / `SUBTASK_COLUMNS`
   (`task-dependencies.db.ts:19`, `:48-50`) carry it. Anything that needs a
   task's parent needs a second read — `taskDependenciesDb.get`
   (`task-dependencies.db.ts:214-219`) is that read.

4. **The election already walks subtasks.** `listReadyBacklogByProject`
   (`task-dependencies.db.ts:179-194`) is project-wide and dependency-aware, so
   subtasks land in the ordinary election with no change. Its `NOT EXISTS ... AND
   blocker.stage <> 'done'` clause is why a subtask must reach **`done`**, not
   `review`, for the next one to be released — see phase-06 §Prompts.

5. **A failed firing still records its dedupe key.**
   `automations.service.ts:158` records the `failed` attempt with
   `context.dedupeKey`, and `existsForDedupeKey` (`:197`) then reports the event
   as already handled. That is what stops the backlog head-of-line block
   (`automation-triggers.service.ts:174-181`) and it applies identically to the
   integration election: an integration that exhausts its three attempts is not
   retried forever.

## Requirements

**Functional**

- A parent whose subtasks are not all `done` does not count against `maxConcurrent`.
- A parent that is `in_progress`, has at least one subtask, and whose every
  subtask is `done`, is re-elected on the minute tick with the intent to integrate.
- At most one integration per rule per tick, mirroring the backlog election.
- The integration fires **once** per completion of a set of children, and fires
  again if a child is reopened and re-finished.
- Everything a subtask's pickup needs to branch correctly is readable through the
  board port: the parent's row, and the tasks it depends on.

**Non-functional**

- No new table, column, stage, trigger kind or action kind.
- Ports stay narrow enough that the fakes in
  `tests/support/fake-automation-deps.ts` remain plain in-memory objects.

## Architecture — data flow

```
minute tick (automation-scheduler.service.ts)
  └─ triggers.runTick(at)                       automation-triggers.service.ts:224
       ├─ runCronAutomations
       ├─ runQuotaAutomations
       ├─ runParentIntegrations(at)        ← NEW, runs before the backlog election
       │    for each enabled task_backlog rule:
       │      board.listParentsAwaitingIntegration(project)   → parents, oldest first
       │        for each: board.listSubtasks(parent.id)       → fingerprint
       │          key = integrate:{id}:{count}:{maxChildUpdatedAt}
       │          first key with no run history wins
       │      fire(automation, { dedupeKey: key, task: parent, intent: 'integrate' })
       └─ runBacklogAutomations(at)             automation-triggers.service.ts:161
            board.countActiveInProgress(project) ≥ maxConcurrent → skip  (was countInProgress)
            board.listReadyBacklog(project) → first key with no history → fire (intent absent)
```

### Why the integration election is *not* gated by `maxConcurrent`

Deliberate and load-bearing. The moment a parent's last child reaches `done`, the
new count formula stops excluding the parent — it is a task with no unfinished
children, so it counts again. Gating integration on the same ceiling would mean
the parent's own slot can block the integration that releases that slot. With
`maxConcurrent: 1` that is a guaranteed deadlock. State it in the function's doc
comment so nobody "fixes" it later.

### Dedupe identity for the re-wake

`integrate:{parentId}:{childCount}:{newest child updated_at}`.

- Fires once per completed set: the fingerprint does not change while nothing
  changes.
- Re-fires after a reopen: moving a child out of `done` and back bumps that
  child's `updated_at`, so the fingerprint changes and the parent integrates the
  new state.
- Re-fires when a child is added to the plan and finished: `childCount` changes.
- **Known hole:** SQLite's `updated_at` is second-granular, so a reopen *and*
  re-completion inside the same second as the previous completion produces the
  same fingerprint and does not re-fire. Accepted (Low×Low); recovery is dragging
  the parent card, which a human is already doing in that scenario.

## Related Code Files

**Modify**

| File | Change |
| --- | --- |
| `server/modules/database/repositories/task-dependencies.db.ts` | 3 new queries (below) |
| `server/modules/automations/automations.types.ts` | port + context contract (§Contract) |
| `server/modules/automations/services/automation-triggers.service.ts` | `runParentIntegrations`, renamed count call, `runTick` order |
| `server/modules/automations/automations.module.ts` | bind the new board methods |
| `server/modules/automations/tests/support/fake-automation-deps.ts` | fake board grows the new methods |
| `server/modules/automations/README.md` | document the two-clause loop |

**Create**

- nothing.

**Not touched** (phase-06 owns them): `task-pickup.service.ts`,
`task-integration.service.ts`, `automation-actions.service.ts`.

## Contract (shared with phase F)

Phase E writes **every** declaration below. Phase F only implements against them.

```ts
// automations.types.ts — AutomationTriggerContext
export interface AutomationTriggerContext {
  dedupeKey: string | null;
  variables: Record<string, string>;
  task?: TaskRow;
  /**
   * Which half of the backlog loop a `pickup_task` firing is.
   *
   * Absent (the default) means "claim a ready ticket". `integrate` means the
   * elected task is a decomposed parent whose subtasks are all done and whose
   * card must not be claimed again — the two paths meet the same task row in
   * two different stages, so the intent cannot be inferred from the row.
   */
  intent?: 'pickup' | 'integrate';
}

// automations.types.ts — AutomationBoardGateway (additions)
export interface AutomationBoardGateway {
  // ...existing five members unchanged...

  /**
   * Tasks in the project that occupy a concurrency slot right now.
   *
   * A parent that decomposed sits in `in_progress` with no agent attached: its
   * subtasks are the work, and counting the parent as well would let one
   * decomposition eat the ceiling and, at `maxConcurrent: 1`, deadlock its own
   * children. A parent whose children are all done counts again — it is about
   * to be handed back an agent for the integration.
   */
  countActiveInProgress(project: string): number;

  /**
   * Decomposed parents ready to be integrated: still `in_progress`, at least
   * one subtask, and every subtask `done`. Oldest first.
   */
  listParentsAwaitingIntegration(project: string): TaskRow[];

  /** A parent's subtasks in plan order — the branches an integration merges. */
  listSubtasks(parentTaskId: string): TaskRow[];

  /**
   * The parent ticket of a subtask, or null for a top-level one. A separate
   * read because `TaskRow` does not carry `parent_task_id`.
   */
  getParentTask(taskId: string): TaskRow | null;

  /**
   * The tasks this one depends on, whatever their stage — their branches carry
   * work it has to build on. Unlike `listBlockers`, done ones are included:
   * by the time a task is elected its blockers are all done, and those are
   * exactly the branches that matter.
   */
  listUpstreamTasks(taskId: string): TaskRow[];
}
```

`countInProgress` is **renamed** to `countActiveInProgress` rather than quietly
given new behaviour — four call sites total (`automations.types.ts:213`,
`automations.module.ts:116`, `automation-triggers.service.ts:170`,
`fake-automation-deps.ts:205`), and a name that says "in progress" while
excluding some in-progress rows is how the next reader gets it wrong.

## Implementation Steps

1. **`task-dependencies.db.ts` — `countActiveInProgressByProject(projectName)`.**
   Lives here, not in `tasks.db.ts`: it is a question about the task *graph*,
   which is this file's stated job (header comment, `:1-10`), and
   `tasksDb.countByStage` stays the honest primitive it is.
   ```sql
   SELECT COUNT(*) AS count FROM tasks t
   WHERE t.project_name = ? AND t.stage = 'in_progress'
     AND NOT EXISTS (
       SELECT 1 FROM tasks child
       WHERE child.parent_task_id = t.id AND child.stage <> 'done'
     )
   ```
   `NOT EXISTS(unfinished child)` is true for a task with no children at all, so
   ordinary solo tickets keep counting exactly as before. Index `idx_tasks_parent`
   (`migrations.ts:833`) covers the subquery.

2. **`task-dependencies.db.ts` — `listParentsAwaitingIntegration(projectName)`.**
   Projects `TASK_COLUMNS` through the existing `qualify` helper
   (`task-dependencies.db.ts:55-59`), like `listReadyBacklogByProject` does.
   ```sql
   SELECT <qualify('t', TASK_COLUMNS)> FROM tasks t
   WHERE t.project_name = ? AND t.stage = 'in_progress'
     AND EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.id)
     AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.id AND c.stage <> 'done')
   ORDER BY datetime(t.created_at), t.rowid
   ```
   The `EXISTS` clause is what keeps a plain solo ticket out of the integration
   queue; without it every ordinary `in_progress` card would be re-dispatched.

3. **`task-dependencies.db.ts` — `listUpstream(taskId)`.** `listBlockers`
   (`:202-212`) minus its `blocker.stage <> 'done'` filter:
   ```sql
   SELECT <qualify('upstream', SUBTASK_COLUMNS)>
   FROM task_dependencies d
   JOIN tasks upstream ON upstream.id = d.depends_on_task_id
   WHERE d.task_id = ?
   ORDER BY datetime(upstream.created_at), upstream.rowid
   ```

4. **`automations.types.ts` — write the contract above verbatim.** Nothing else
   in the file changes.

5. **`automations.module.ts` — bind the five board members** next to the existing
   ones at `:114-143`:
   ```ts
   countActiveInProgress: (project) => taskDependenciesDb.countActiveInProgressByProject(project),
   listParentsAwaitingIntegration: (project) => taskDependenciesDb.listParentsAwaitingIntegration(project),
   listSubtasks: (parentTaskId) => taskDependenciesDb.listSubtasks(parentTaskId),
   getParentTask: (taskId) => {
     const parentId = taskDependenciesDb.get(taskId)?.parent_task_id ?? null;
     return parentId ? tasksDb.get(parentId) : null;
   },
   listUpstreamTasks: (taskId) => taskDependenciesDb.listUpstream(taskId),
   ```
   `tasksDb` and `taskDependenciesDb` are both already imported (`:18`).

6. **`automation-triggers.service.ts` — rename the gate call** at `:170` to
   `deps.board.countActiveInProgress(config.project)`. No other change to
   `runBacklogAutomations`.

7. **`automation-triggers.service.ts` — add `runParentIntegrations(at)`** beside
   `runBacklogAutomations`, same shape (`listEnabledByTrigger('task_backlog')`,
   same project guard, `fireSafely`, at most one per rule per tick):
   ```ts
   for (const parent of deps.board.listParentsAwaitingIntegration(config.project)) {
     const children = deps.board.listSubtasks(parent.id);
     const newest = children.reduce((latest, child) =>
       child.updated_at > latest ? child.updated_at : latest, '');
     const key = `integrate:${parent.id}:${children.length}:${newest}`;
     if (!deps.repository.runs.existsForDedupeKey(automation.automation_id, key)) { … }
   }
   ```
   Fire with `{ dedupeKey, variables: { ...baseVariables(automation, at), ...taskVariables(parent, null) }, task: parent, intent: 'integrate' }`.
   `taskVariables` is already imported (`:24`). Carry the "no `maxConcurrent`
   gate" reasoning in the doc comment.

8. **`runTick` (`:224-229`)** — run integrations *before* the backlog election so
   a finished plan is never starved by a tick that spent its election on a fresh
   ticket:
   ```ts
   const integrations = await runParentIntegrations(at);
   const backlog = await runBacklogAutomations(at);
   return [...cron, ...quota, ...integrations, ...backlog];
   ```

9. **`fake-automation-deps.ts` — extend `FakeBoard`.** Add a `parents: Map<childId, parentId>`
   and an `upstream: Map<taskId, taskId[]>` alongside the existing `dependencies`
   map (`:163`), seeded through `FakeBoardTaskSeed` (`parentTaskId?: string` in
   addition to the existing `dependsOn`), then implement the five members in
   memory. `countActiveInProgress` mirrors the SQL: in-progress tasks with no
   child that is not `done`.

10. **Tests.**
    - `server/modules/database/tests/task-dependencies.db.test.ts` (existing file,
      style at `:1-45`): a parent with one child in `in_progress` is not counted
      and is not an integration candidate; the same parent with every child `done`
      is counted and *is* a candidate; a childless `in_progress` ticket is counted
      and is never a candidate; `listUpstream` returns done dependencies where
      `listBlockers` returns none. Add the missing coverage for
      `listReadyBacklogByProject` while here — it has none today.
    - `server/modules/automations/tests/automation-triggers.test.ts`: a tick with
      a fully-done plan fires once with `intent: 'integrate'`; a second tick with
      no change fires nothing; reopening a child and re-finishing it fires again;
      a project at its ceiling still integrates (the no-gate rule); the parent of
      an unfinished plan does not consume a slot.

## Todo List

- [ ] `countActiveInProgressByProject` + test
- [ ] `listParentsAwaitingIntegration` + test
- [ ] `listUpstream` + test
- [ ] `listReadyBacklogByProject` coverage backfilled
- [ ] Contract written in `automations.types.ts` (context `intent` + five board members)
- [ ] `countInProgress` renamed at all four sites
- [ ] Module bindings
- [ ] `runParentIntegrations` + `runTick` order
- [ ] Fake board extended
- [ ] Trigger tests (fire once, no re-fire, re-fire on reopen, no ceiling gate, parent excluded from the count)
- [ ] `README.md` updated: the loop has two clauses now
- [ ] `npm run build:server` && `npm run typecheck` && `npm run lint` clean

## Success Criteria

- With `maxConcurrent: 1`, a decomposed parent's subtasks are picked up one after
  another — proof the parent is not eating the only slot.
- A plan whose subtasks are all `done` produces exactly one `integrate:` run row
  per rule, whose detail names the parent.
- The pre-existing automations and task-dependency suites pass unmodified;
  every change here is additive except the rename.

## Risk Assessment

| Risk | L×I | Mitigation |
| --- | --- | --- |
| Integration gated by `maxConcurrent` → parent blocks its own release (deadlock at 1) | Med×High | Explicitly ungated + doc comment + a test that asserts it fires at the ceiling |
| `countActiveInProgress` also excludes a parent whose children are all done → nothing counts it during integration | Med×Med | `NOT EXISTS(unfinished child)` counts it again the moment the last child lands; direct test |
| Integration exhausts 3 attempts → parent stuck `in_progress`, holding a slot | Med×Med | Recorded `failed` rows in `/runs` name it; recovery is dragging the card. Not auto-reverted: reverting to backlog would re-elect it as a *fresh* pickup and decompose it a second time |
| Reopen inside the same second as the previous completion → no re-fire | Low×Low | Documented; human is already in the loop in that scenario |
| Rename missed at one call site | Low×Low | `tsc` catches it — the port is an interface |
| A child moved to `done` by hand while its agent still runs → integration merges a half-written branch | Low×Med | Not guarded (YAGNI). If it ever bites: loop `agent.hasLiveSessionForBranch` over the child branches in phase-06's integration service before dispatching |

## Rollback

Self-contained and additive except the rename. Revert this phase and phase-06
together: `intent` is declared here and read there. No stored data is affected —
no rule config, no schema, no run-history format change (the new dedupe keys are
just strings in an existing column). Decomposed parents left behind stay
`in_progress` and are moved by hand, exactly as they would be today.

## Security Considerations

- No new REST surface, no new config field, nothing user-authored reaches SQL:
  every new query is parameterised, same as its neighbours.
- `listParentsAwaitingIntegration` is project-scoped, so a rule cannot re-wake a
  parent on a board it was not configured for — same containment as
  `listReadyBacklogByProject`.

## Next Steps

Phase F implements against this contract. They can be developed in parallel and
**must land together**: `build:server` is red between them, because `intent` and
the board additions are declared here and consumed there.

## Unresolved Questions

1. Should an integration that exhausts its three attempts notify (a `notify_push`
   sibling rule), or is the run history enough? Current plan: history only.
