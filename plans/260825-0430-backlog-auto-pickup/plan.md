---
title: "Backlog Auto-Pickup"
description: "Server drains the backlog: a minute-tick trigger elects the oldest ready ticket, gives it a worktree, dispatches an agent — solo or orchestrating — then an agent first-pass reviews it and a human approves the merge."
status: in-progress
priority: P2
effort: 28h
branch: feat/agent-orchestration-phase2
tags: [automations, task-board, worktrees, orchestration]
created: 2026-08-25
---

# Backlog Auto-Pickup

Implements `docs/superpowers/specs/2026-08-25-backlog-auto-pickup-design.md` (approved, final).
New automation trigger `task_backlog` + new action `pickup_task`, plus a board-header toggle.

Phases E–F extend the same loop into a conditional orchestrator: a large ticket is
decomposed by its own agent, the election drains the subtasks in dependency order,
and the parent is re-dispatched at the end to merge them into one review.

Phases G–H close the loop at the human gate: G repairs a defect that blocks
everything above it (server-spawned agents have no bridge tools at all), and H adds
a first-pass agent reviewer on top of the existing review, with approval — and the
merge — still human.

## Phases

| # | Phase | Owns | Depends on | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| A | [Trigger & election contract](phase-01-trigger-and-contract.md) | `automations.types.ts`, `automations.validation.ts`, `automation-triggers.service.ts`, DB kind unions + schema + migration, `tasks.db.ts`, `task-dependencies.db.ts`, `tests/support/fake-automation-deps.ts` | — | 4h | **done** (b18f5db) |
| B | [Pickup action & wiring](phase-02-pickup-action.md) | `automation-actions.service.ts`, `task-pickup.service.ts` (new), `automations.module.ts`, `worktrees/index.ts` | A's contract (declared, not merged) | 4h | **done** (b18f5db, + post-review hardening) |
| C | [Board toggle](phase-03-board-toggle.md) | `AutoPickupToggle.tsx` (new), `use-auto-pickup.ts` (new), `TaskBoardTab.tsx` | REST contract only | 2h | **done** (14fa0db) |
| D | [Integration & smoke](phase-04-integration.md) | nothing (verification only) | A + B + C | 1h | **partial** — build/typecheck/lint/tests green and deployed; the end-to-end smoke checkboxes are still unticked |
| E | [Parent lifecycle & integration election](phase-05-parent-lifecycle-and-election.md) | `task-dependencies.db.ts`, `automations.types.ts`, `automation-triggers.service.ts`, `automations.module.ts`, `tests/support/fake-automation-deps.ts`, `automations/README.md` | B (merged) | 4h | pending |
| F | [Orchestrator prompts & integration run](phase-06-orchestrator-prompts-and-integration.md) | `task-pickup.service.ts`, `task-integration.service.ts` (new), `automation-actions.service.ts`, `skills/maestro/SKILL.md` | E's contract (declared, not merged) | 4h | pending |
| G | [Bridge access for spawned sessions](phase-07-bridge-access-for-spawned-sessions.md) | `agent-bridge.module.ts` + `index.ts`, `automation-agent-spawn.service.ts`, `automations.module.ts`, `claude-sdk.js`, `agent-bridge/README.md` | E (shares `automations.module.ts`) | 4h | pending — **P0, see below** |
| H | [First-pass reviewer & merge gate](phase-08-first-pass-reviewer-and-merge-gate.md) | `agent-bridge.tools/types/module.ts`, `agent-bridge-mcp.ts`, `reviews.service.ts`, `use-auto-pickup.ts`, `automations.validation.ts` (+ E's `automations.types.ts`, F's `automation-actions.service.ts`) | E + F + G | 5h | pending |

### Post-review hardening already landed on top of B

Not re-planned; recorded so E and F build on the real file, not on phase-02's text:
a live-session-per-branch guard, a compare-and-swap `moveToInProgress(…, expectedStage)`,
`revertToBacklog` on spawn failure, and a delimited prompt (instructions first, task
data fenced last) — all in `server/modules/automations/services/task-pickup.service.ts`.

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

E and F repeat that shape: **E declares, F implements, they land together.**
E widens `AutomationTriggerContext` with `intent` and `AutomationBoardGateway`
with five members; F is the only phase that reads them. No two of E's and F's
files overlap — see each phase's "Not touched" list.

**G and H are sequential, not parallel.** G shares `automations.module.ts` with E,
and H edits `automations.types.ts` (E's) and `automation-actions.service.ts` (F's).
Order: **E+F → G → H.**

## P0 — a defect found while planning the reviewer

Server-spawned sessions have **no agent-bridge tools**. Every prompt in phases
B, F and H tells the agent to call `task_evidence_add`, `task_update_stage` or
`review_comment_add`; none of them exist in those runs. The bridge's registration
is per session and, by its own composition root's comment
(`agent-bridge.module.ts:113-120`), is written into the provider's MCP config by
"the UI (or a human" — and no client calls the minting endpoint. The spawn path
passes no MCP config at all (`automation-agent-spawn.service.ts:158-164`).

This means the deployed auto-pickup very likely never moves a card by itself. It
is exactly what phase D's unticked end-to-end smoke would have caught.
[Phase G](phase-07-bridge-access-for-spawned-sessions.md) fixes it and is a
prerequisite for F's subtask flow and H's reviewer alike.

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

## Key decisions for the orchestrator flow (E–F)

- **Conditional, judged by the agent.** The pickup prompt describes both ways of
  running a ticket and the criteria for choosing. No size heuristic in code —
  tuning stays a prompt change.
- **The parent integrates at the end** (user's choice). Subtask worktrees branch
  from the parent's branch, not the project default; the parent is re-dispatched
  once every subtask is `done` and merges them into its own branch. One review.
- **A decomposed parent does not occupy a concurrency slot** while its children
  run, and occupies one again the moment the last child lands. Expressed as
  `NOT EXISTS (unfinished child)` in the count query — see
  [phase-05 step 1](phase-05-parent-lifecycle-and-election.md#implementation-steps).
- **Re-wake is a second election clause on the same tick**, on the same rule and
  the same `pickup_task` action, discriminated by `context.intent`. No new trigger
  kind, no new action kind, no schema change, no migration.
- **Subtasks finish on `done`, never `review`.** Verified: a card on `review` opens
  a review whose approval merges that branch into **main**
  (`reviews.module.ts:79-84` → `worktree-merge.service.ts:43-46`), and dependents
  are only released by `stage = 'done'` (`task-dependencies.db.ts:189`).
- **Maestro is used for its planning half only.** `task_decompose` yes,
  `task_delegate` no — the backlog election is the dispatcher.

## Key decisions for the human gate (G–H)

- **Bridge access is injected in memory**, into the spawn options, not written to
  `.mcp.json` (the agent could commit it and the approval would merge the token
  into the base branch) and not to `~/.claude.json` `projects[…]` (the runtime
  reads a different key — `claudeProjects`, `claude-sdk.js:496`).
- **The reviewer rides existing machinery**: a `task_stage` rule with
  `toStage: review` firing the existing `prompt_agent` action. The only addition
  is an opt-in `useTaskWorktree` flag, because one rule serves every card and the
  worktree cannot be named in config. **No new action kind, no migration.**
- **Approval is human-only by construction.** The bridge gains exactly one review
  tool — `review_comment_add` — and nothing that changes review state; the approve
  route stays behind the UI's JWT.
- **The review cycle terminates without a counter.** `task_stage` dedupes on
  `task:{id}:stage:review`, so one first pass per card, ever; `requestChanges`
  never moves the card, so it raises no new event.
- **A failed merge becomes a review comment**, routed to the author session on the
  path human comments already take. Today the conflict exists only in the HTTP
  response and dies with the dialog.
- **Merge-on-approve already works** and needs no change: the card is moved to
  `done` at `reviews.service.ts:249`, and the merge source for a decomposed ticket
  is already the parent's branch. Phase H verifies it rather than rebuilding it.

## Risks

| Risk | Phase | L×I | Mitigation |
| --- | --- | --- | --- |
| Failed pickup permanently starves the queue (head-of-line block) | A | High×High | Election skips candidates that already have history for their dedupe key — [phase-01 step 5](phase-01-trigger-and-contract.md#implementation-steps) |
| New action kind silently runs `notify_push` (fallthrough at `automation-actions.service.ts:121`) | B | High×High | Explicit `pickup_task` branch **before** the fallthrough + a test asserting it |
| Retry re-creates an existing worktree → 409, all 3 attempts fail | B | High×Med | Reuse an existing worktree for the branch instead of creating — [phase-02 step 4](phase-02-pickup-action.md#implementation-steps) |
| Migration drops `automations` with FK children | A | Low×High | `PRAGMA foreign_keys = OFF` + explicit transaction, per the house rebuild pattern |
| Worktrees barrel import closes a cycle | B | Low×Med | Mirror `reviews.module.ts`; fallback is a direct service-file import |
| Decomposed parent eats the concurrency ceiling (deadlock at `maxConcurrent: 1`) | E | High×High | Count excludes parents with unfinished children — [phase-05 step 1](phase-05-parent-lifecycle-and-election.md#implementation-steps) |
| Integration gated by the same ceiling → parent blocks its own release | E | Med×High | Integration election is deliberately ungated; asserted by a test |
| Subtask agent moves its card to `review` → merges into main, plan freezes | F | Med×High | Prompt says `done` and why, twice; smoke asserts no review opens |
| Agent decomposes trivial tickets | F | Med×Med | Criteria + "when unsure, do it yourself" + a solo-ticket smoke step |
| Sibling subtasks conflict at integration | F | High×Med | Inherent to integrate-at-the-end; dependents merge their upstream branches first, and the integration prompt may stop and report |
| Integration exhausts its retries → parent stuck `in_progress` | E | Med×Med | Recorded in `/runs`; not auto-reverted — reverting would decompose the ticket a second time |
| Spawned agents have no bridge tools → every prompt's instructions are unreachable | G | **High×High** (present today) | [Phase G](phase-07-bridge-access-for-spawned-sessions.md); smoke step 3 there is the proof |
| Claude runtime ignores injected `mcpServers` | G | Med×High | Smoke reads the session's live tool list; documented fallback to `.mcp.json` + a git exclude |
| Reviewer joins a worktree whose author agent is still running | H | Med×High | `hasLiveSessionForBranch` guard before dispatch — clean skip, no retry burn |
| Reviewer noise on every card | H | Med×Med | Prompt is rule data, editable without a deploy; scoped to the diff |
| Merge conflict lost with the dialog | H | Med×Med | Recorded as a review-wide comment and routed to the author |

## Unresolved questions

Listed at the end of [phase-01](phase-01-trigger-and-contract.md#unresolved-questions),
[phase-03](phase-03-board-toggle.md#unresolved-questions),
[phase-06](phase-06-orchestrator-prompts-and-integration.md#unresolved-questions),
[phase-07](phase-07-bridge-access-for-spawned-sessions.md#unresolved-questions) and
[phase-08](phase-08-first-pass-reviewer-and-merge-gate.md#unresolved-questions).

Decided by the lead: dependent subtasks **do** merge their finished upstream
branches (phase-06 step 4); `done`-not-`review` stays prompt-enforced; a stuck
parent after a failed integration is manual recovery.

Still open, neither blocking: whether the reviewer gets its own board toggle
instead of riding on Auto-pickup, and whether a card a human dragged to review
should be reviewed too (default: yes to both riding along and reviewing).
