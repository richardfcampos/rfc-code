# Phase A — Trigger `task_backlog` & the shared contract

## Context Links

- Spec (authoritative): `docs/superpowers/specs/2026-08-25-backlog-auto-pickup-design.md`
- Engine contract: `server/modules/automations/README.md`
- Sibling phase consuming this contract: [phase-02](phase-02-pickup-action.md)

## Overview

- **Priority:** P1 (blocks B)
- **Status:** pending
- **Effort:** 4h
- Declare the new trigger/action kinds everywhere the codebase pins them (types,
  validation, DB unions, SQL CHECK), add the two queries election needs, and
  implement `task_backlog` evaluation on the existing minute tick.

This phase owns **the entire shared type surface**. Phase B writes no type
declarations — that is what lets both run in parallel.

## Key Insights

1. **Kinds are not declared in the automations module.** `AutomationTriggerKind`
   and `AutomationActionKind` are at `server/modules/database/repositories/automations.db.ts:13-14`
   and re-exported through `server/modules/database/index.ts:16,20`.
   `automations.validation.ts:16-17` keeps a parallel runtime array — both must change.

2. **A SQL CHECK pins the kind lists.** `server/modules/database/schema.ts:432-433`
   (`trigger_kind`) and `:438-439` (`action_kind`). Because `runMigrations` runs
   after `INIT_SCHEMA_SQL` (`init-db.ts:9-11`) and the table is
   `CREATE TABLE IF NOT EXISTS`, an existing install keeps the narrow CHECK. Without
   a rebuild, creating a `task_backlog` rule fails at INSERT.

3. **No CHECK-widening precedent exists**, but two full table rebuilds do —
   `rebuildSessionsTableWithProjectSchema` at `migrations.ts:260-405` and
   `rebuildProjectsTableWithPrimaryKeySchema` at `:133-258`. Copy their mechanics.
   There is no schema-version table: every migration step is idempotent-on-every-boot
   and must self-guard.

4. **Neither election query exists.**
   - `taskDependenciesDb.listReady` (`task-dependencies.db.ts:151-166`) has the right
     `NOT EXISTS` dependency filter and the right `ORDER BY datetime(t.created_at), t.rowid`,
     but is scoped by `WHERE t.parent_task_id = ?` (`:156`) — top-level tasks are
     invisible to it and there is no project filter. Not reusable; write a sibling.
   - Nothing counts tasks by stage. `COUNT(` appears in no task repository, `GROUP BY`
     appears nowhere under `repositories/`. Mirror `sessionsDb.countSessionsByProjectPath`
     (`sessions.db.ts:564-577`).

5. **Head-of-line blocking is the sharp edge.** `existsForDedupeKey` counts *failed*
   attempts too — deliberately (`automations.db.ts:207-213`). Combined with
   "elect at most one task per tick", a ticket whose pickup exhausted its 3 retries
   would be re-elected every tick forever, return `skipped`, and no other ticket in
   the project would ever be picked up. Election must therefore skip candidates that
   already have history for their key. This uses the existing
   `AutomationRepositoryGateway.runs.existsForDedupeKey` port (`automations.types.ts:175`)
   — no new dependency.

## Requirements

**Functional**
- `task_backlog` is a valid trigger kind, accepted by validation, storable, and evaluated on the minute tick alongside `cron` and `quota_threshold`.
- `pickup_task` is a valid action kind and its config validates (execution is Phase B).
- Per enabled rule per tick: skip when `count(in_progress in project) >= maxConcurrent`; otherwise elect the oldest `backlog` task in the project whose dependencies are all `done` **and** which has no run history for its current identity; fire once.
- Dedupe key is `backlog:{taskId}:{task.updated_at}` — the same task in the same state never fires twice; a re-backlogged task (new `updated_at`) fires again.

**Non-functional**
- Existing installs upgrade without manual intervention; migration is a no-op on second boot.
- One rule failing never stops the tick (existing `fireSafely` contract, `automation-triggers.service.ts:52-66`).
- Files stay under 200 lines; `automation-triggers.service.ts` is at 204 and will grow — extract the backlog election into `services/automation-backlog-election.ts` if it passes ~260.

## Contract shared with Phase B

Phase A writes all of the below verbatim into `automations.types.ts`. Phase B codes
against these names and touches none of them.

```ts
/** Drains a project's backlog on the minute tick. */
export interface TaskBacklogTriggerConfig {
  /** The board's project id, matched against `TaskRow.project_name`. Required. */
  project: string;
  /** Ceiling on concurrently running tickets in the project. Integer 1–10, defaults to 2. */
  maxConcurrent: number;
}

export interface PickupTaskActionConfig {
  /** Repository the worktree is cut from; also what the org policy resolves against. */
  projectPath: string;
  provider?: LLMProvider;
  /** Optional explicit account. Still checked against the org allow-list. */
  profileId?: string;
  /** Base for the ticket's new branch; defaults to the main worktree's branch. */
  baseBranch?: string;
}
```

Both unions gain a member:

```ts
export type AutomationTriggerConfig = … | TaskBacklogTriggerConfig;
export type AutomationActionConfig  = … | PickupTaskActionConfig;
```

Two new ports, plus their two lines on `AutomationServiceDeps`:

```ts
/** The board, as election and pickup need it. */
export interface AutomationBoardGateway {
  /** Backlog tasks in the project whose dependencies are all done, oldest first. */
  listReadyBacklog(project: string): TaskRow[];
  /** Tasks currently `in_progress` in the project — every one of them, whoever started it. */
  countInProgress(project: string): number;
  /** Re-reads a task; null when it no longer exists. Used for the claim re-check. */
  getTask(taskId: string): TaskRow | null;
  /** Moves a card to `in_progress` and stamps its branch in one write, then broadcasts. */
  moveToInProgress(taskId: string, worktreeBranch: string): Promise<TaskRow>;
}

/** Creating the isolation a ticket is worked in. */
export interface AutomationWorktreeGateway {
  /**
   * Returns the worktree for `branch`, creating it when it does not exist yet.
   * Reuse rather than create is what makes a retried pickup safe.
   */
  ensureWorktree(input: {
    projectPath: string;
    branch: string;
    baseBranch?: string | null;
  }): Promise<{ worktreePath: string; branch: string }>;
}

export interface AutomationServiceDeps {
  // …existing members unchanged…
  board: AutomationBoardGateway;
  worktrees: AutomationWorktreeGateway;
}
```

`AutomationTriggerContext` needs **no change** — it already carries `task?: TaskRow`
(`automations.types.ts:124`), which is how the elected task reaches the action.

**Contract freeze:** if Phase B needs a field not listed here, it must be requested
from Phase A rather than added locally — two phases editing `automations.types.ts`
is the one thing that breaks the parallel split.

## Related Code Files

**Modify**
- `server/modules/database/repositories/automations.db.ts` — kind unions, `:13-14`
- `server/modules/database/schema.ts` — CHECK lists, `:433` and `:439`
- `server/modules/database/migrations.ts` — new rebuild helper + its call at `:954`
- `server/modules/database/repositories/tasks.db.ts` — `countByStage`, after `listByProject` (`:91-107`)
- `server/modules/database/repositories/task-dependencies.db.ts` — `listReadyBacklogByProject`, after `listReady` (`:151-166`)
- `server/modules/automations/automations.types.ts` — the contract above
- `server/modules/automations/automations.validation.ts` — kind arrays `:16-17`, both config validators
- `server/modules/automations/services/automation-triggers.service.ts` — backlog evaluation in `runTick` (`:177-181`)
- `server/modules/automations/tests/support/fake-automation-deps.ts` — fakes for the two new ports
- `server/modules/automations/README.md` — trigger/action config tables (`:48-84`)

**Create**
- `server/modules/database/tests/automations-kind-migration.test.ts`

**Delete** — none.

## Implementation Steps

1. **Widen the kind unions.** `automations.db.ts:13` → add `| 'task_backlog'`;
   `:14` → add `| 'pickup_task'`. No other change in that file.

2. **Widen the CHECK lists.** `schema.ts:433` → add `'task_backlog'`;
   `:439` → add `'pickup_task'`. This covers fresh installs only.

3. **Migrate existing installs.** Add a private helper in `migrations.ts`, placed
   after `createTaskDecomposition` (ends `:842`) and before `runMigrations` (`:844`):
   - Guard: if `automations` does not exist, return (schema SQL already made it).
   - Detect: read `SELECT sql FROM sqlite_master WHERE type='table' AND name='automations'`.
     If the text already contains `task_backlog`, return. This is the idempotency
     guard — there is no version table. Note nothing else in the codebase reads
     `sqlite_master.sql` text; this detector is net-new.
   - Rebuild, copying `rebuildSessionsTableWithProjectSchema` (`:260-405`) exactly:
     `console.log('Running migration: …')` → `PRAGMA foreign_keys = OFF` **outside**
     the transaction → `BEGIN TRANSACTION` → `DROP TABLE IF EXISTS automations__new`
     → `CREATE TABLE automations__new (…)` with the **widened** CHECK, written inline
     as a literal (the house style deliberately does not reuse `schema.ts`) →
     `INSERT INTO automations__new SELECT <explicit columns> FROM automations` →
     `DROP TABLE automations` → `ALTER TABLE automations__new RENAME TO automations`
     → `COMMIT`, with `ROLLBACK` in `catch` and `PRAGMA foreign_keys = ON` in `finally`.
   - The pragma must stay OFF for the drop: `automation_runs` has
     `FOREIGN KEY (automation_id) … ON DELETE CASCADE` (`schema.ts:489`), and history
     must survive.
   - Call it at `migrations.ts:954`, immediately after `db.exec(AUTOMATIONS_TABLE_SCHEMA_SQL)`
     and **before** the `CREATE INDEX IF NOT EXISTS idx_automations_trigger` on `:955` —
     the rebuild drops the old table and its indexes, so the existing index line
     re-creates it.

4. **Add the two queries.**
   - `tasks.db.ts`, sibling of `listByProject`:
     `countByStage(projectName: string, stage: TaskStage): number` —
     `SELECT COUNT(*) AS count FROM tasks WHERE project_name = ? AND stage = ?`,
     returning `Number(row?.count ?? 0)` exactly as `sessions.db.ts:564-577` does.
   - `task-dependencies.db.ts`, sibling of `listReady`:
     `listReadyBacklogByProject(projectName: string): TaskRow[]` — same
     `NOT EXISTS`/`ORDER BY` body as `:154-163`, but `WHERE t.project_name = ?`
     instead of `t.parent_task_id = ?`. Project `TASK_COLUMNS` from `tasks.db.ts`,
     not `SUBTASK_COLUMNS`, so the return type is a plain `TaskRow`.
     **Decision:** subtasks are included (no `parent_task_id` filter) — a subtask with
     all dependencies done is ready work, and the dependency filter already orders it
     correctly. See Unresolved Questions.
   - Both are reachable through the existing `database/index.ts` barrel exports of
     `tasksDb` / `taskDependenciesDb`; no barrel edit needed.

5. **Elect, in `automation-triggers.service.ts`.** Add `runBacklogAutomations(at: Date)`
   next to `runQuotaAutomations` (`:103-147`) and include it in `runTick` (`:177-181`),
   which becomes `[...cron, ...quota, ...backlog]`. Per rule:
   1. Parse config; skip the rule unless `project` is a non-empty string. Read
      `maxConcurrent`, defaulting to `2` when absent or not a number.
   2. `if (deps.board.countInProgress(config.project) >= maxConcurrent) continue;`
   3. `const candidates = deps.board.listReadyBacklog(config.project);` — already oldest-first.
   4. Walk candidates in order and take the **first** whose
      `backlog:{id}:{updated_at}` key returns `false` from
      `deps.repository.runs.existsForDedupeKey(automation.automation_id, key)`.
      Skipping keys that already have history is what stops a permanently failed
      ticket from starving every ticket behind it. Do not take `candidates[0]` blindly.
   5. No electable candidate → `continue`.
   6. `fireSafely(automation, { dedupeKey: key, variables: { ...baseVariables(automation, at),
      ...taskVariables(elected, null) }, task: elected })` — one election per rule per tick.
   Keep every failure non-fatal to the tick, matching the cron/quota branches.

6. **Validate.** In `automations.validation.ts`:
   - `:16` → append `'task_backlog'`; `:17` → append `'pickup_task'`.
   - `validateTriggerConfig`, new `task_backlog` branch before the webhook fallthrough:
     `project` via `requireString`; `maxConcurrent` via `requireNumber` with
     `{ min: 1, max: 10 }`, defaulting to `2` when absent/null — mirroring how
     `cooldownMinutes` defaults at `:165-172`. `requireNumber` (`:104-118`) does **not**
     check integrality; add an optional `integer` flag to its bounds argument and use it,
     rather than writing a second numeric helper.
   - `validateActionConfig`, new `pickup_task` branch. It must sit **before** the
     trailing `notify_push` fallthrough at `:220-226`. Fields: `projectPath` required;
     `provider` optional and checked against `PROVIDERS` (`:19`) exactly as
     `prompt_agent` does at `:193-199`; `profileId` and `baseBranch` optional strings.

7. **Fakes.** In `tests/support/fake-automation-deps.ts`, add `board` and `worktrees`
   defaults to `createFakeDeps` (`:152-193`) so every existing test keeps compiling,
   and expose the recorded calls on `FakeAutomationDeps` (`:143-149`) the way `prompts`
   and `pushes` already are. Give the fake board an in-memory task list a test can seed.
   **Phase B's tests import these fakes** — get them right here.

8. **Document.** Add the two config blocks to `README.md:48-84` and a `task_backlog`
   row to the placeholder table at `:91-95` (it carries the same `{{task.*}}` set as
   `task_stage`, with `{{task.previousStage}}` empty).

## Todo List

- [ ] Kind unions widened (`automations.db.ts:13-14`)
- [ ] CHECK lists widened (`schema.ts:433,439`)
- [ ] Rebuild migration + call site at `migrations.ts:954`
- [ ] `tasksDb.countByStage`
- [ ] `taskDependenciesDb.listReadyBacklogByProject`
- [ ] Contract types + two ports in `automations.types.ts`
- [ ] `task_backlog` + `pickup_task` config validation
- [ ] Backlog election in `runTick`
- [ ] Fakes for `board` / `worktrees`
- [ ] Tests below all green
- [ ] README config tables updated

## Test Matrix

`server/modules/automations/tests/automation-triggers.test.ts` (extend — node:test +
`assert/strict`, built via the local `build()` helper at `:10-17`):

- concurrency gate: `countInProgress` at the limit fires nothing; one below fires once
- oldest-first: two ready tasks → the older one is elected
- dependency filter: a task with an unfinished blocker is never elected
- dedupe: same task + same `updated_at` observed on two ticks fires once
- re-backlog: same task with a newer `updated_at` fires again
- **starvation guard:** the oldest candidate already has history → the next candidate is elected
- `maxConcurrent` absent from a stored config falls back to 2
- a rule whose `project` is missing is skipped, not fatal to the tick

`server/modules/automations/tests/automations.service.test.ts` or the validation tests:
- `task_backlog` requires `project`; rejects `maxConcurrent` of 0, 11, and 2.5; defaults to 2
- `pickup_task` requires `projectPath`; rejects an unknown `provider`

`server/modules/database/tests/automations-kind-migration.test.ts` (new — mirror
`task-decomposition-migration.test.ts:23-42`, which uses `withIsolatedDatabase`,
`closeConnection()` then `initializeDatabase()`):
- seed a legacy `automations` table by hand with the **narrow** CHECK and one row,
  run `runMigrations`, assert a `task_backlog` insert now succeeds and the seeded row survived
- run `runMigrations` twice; assert no duplication and no error
- assert `automation_runs` history rows survive the rebuild

Run: `npx tsx --tsconfig server/tsconfig.json --test server/modules/automations/tests/*.test.ts`

## Success Criteria

- `npm run typecheck` clean for `server/tsconfig.json`.
- Every test above passes; the pre-existing automations suite still passes untouched.
- On a database created before this change, `POST /api/automations` with
  `trigger_kind: "task_backlog"` returns 201 (not `SQLITE_CONSTRAINT_CHECK`).
- A seeded rule elects exactly one task per tick and stops at the concurrency ceiling.

## Risk Assessment

| Risk | L×I | Mitigation |
| --- | --- | --- |
| Starved queue after a failed pickup | High×High | Step 5.4 — election skips keys with history |
| Migration loses rows or history | Low×High | Explicit transaction + `ROLLBACK`; test asserts survival of both tables |
| Migration re-runs and rebuilds every boot | Med×Med | `sqlite_master.sql` text guard; "runs twice" test |
| Index lost after `RENAME TO` | Med×Low | Call the rebuild *before* the existing `CREATE INDEX IF NOT EXISTS` at `:955` |
| `automation-triggers.service.ts` outgrows 200 lines | High×Low | Extract election into `services/automation-backlog-election.ts` |

## Security Considerations

- `project` and `projectPath` are attacker-influenced only through an authenticated
  JWT surface; both go through `requireString`, which trims and caps at 8000 chars (`:72-81`).
- No new REST surface, so no new authz boundary.
- Account selection stays with the org policy engine — the action config may *narrow*
  a profile, never grant one (`automation-agent-spawn.service.ts:85-116`).

## Rollback

Disable or delete the rule — the trigger only walks
`listEnabledByTrigger('task_backlog')`, so zero rules means zero behaviour change.
Code rollback: revert the commit. The migration is **not** reversible-by-revert — a
rebuilt table keeps the wide CHECK, which is harmless (a superset). Do not write a
narrowing down-migration.

## Next Steps

Unblocks Phase B (which binds the two new ports in the composition root) and Phase D.

## Unresolved Questions

1. Should project-wide election include **subtasks** (`parent_task_id IS NOT NULL`)?
   Planned as yes. If a decomposed parent's subtasks should be driven only by the
   decomposition service, add `AND t.parent_task_id IS NULL` to the new query.
2. `countInProgress` counts every `in_progress` task in the project, per the stated
   constraint — including cards a human moved by hand. Confirmed intent, noted here
   because it means manual work throttles auto-pickup.
