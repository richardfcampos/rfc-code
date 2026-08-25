# Phase H — First-pass reviewer & the merge gate

## Context Links

- Blocked by [phase-07](phase-07-bridge-access-for-spawned-sessions.md) (the reviewer's only write path is a bridge tool) and by [phase-06](phase-06-orchestrator-prompts-and-integration.md) (shared files, below)
- Reviews module: `server/modules/reviews/` · Bridge: `server/modules/agent-bridge/`

## Overview

- **Priority:** P1
- **Status:** pending
- **Effort:** 5h
- Closes the loop: an agent does the first review pass, a human still presses
  Approve, and an approval that cannot merge says so on the review instead of
  failing into a dialog nobody kept.

## Key Insights (verified)

1. **The card already moves to `done` on approval.** `approve` calls
   `deps.setTaskStage(context.task.id, 'done')` (`reviews.service.ts:249`), bound
   to `setTaskStage` → `tasksService.updateTask` + `broadcastTaskUpdate`
   (`reviews.module.ts:43-47`). A failure there is caught, logged, and returned
   as `taskUpdateError` **without** failing the approval, because the merge has
   already landed (`:246-257`). Nothing needs adding for the happy path — B is a
   verification job plus one gap, below.

2. **The merge target is the main worktree's branch.** `approve` passes
   `context.repositoryRoot` and `context.worktreePath`
   (`reviews.service.ts:233-239`); `mergeWorktree` resolves
   `targetBranch = entries[0].branch` — the branch checked out in the main
   worktree (`worktree-merge.service.ts:45-46`). For a decomposed ticket the
   source is `context.branch`, which `resolveReviewContext` takes from
   `task.worktree_branch` and then matches against live `git worktree list`
   output (`review-context.service.ts:71-89`) — i.e. `auto/task-{parentId}`,
   exactly the branch phase-06's integration run merges into. **No change needed.**

3. **A conflict is already safe, but not durable.** `mergeWorktree` aborts,
   `git reset --merge`s the base worktree back (`worktree-merge.service.ts:99-117`)
   and throws `WORKTREE_MERGE_CONFLICT` (409) carrying the conflicted paths
   (`:119-128`). Because it throws *before* `taskReviewsDb.setState(…, 'approved')`
   (`reviews.service.ts:241`), the review stays live and the button can be pressed
   again. What is missing: the error exists only in the HTTP response. Nothing is
   written to the review or the card, so a dismissed dialog loses it and the
   author agent is never told. **That is the only gap in B.**

4. **The reviews module already pages the author agent.** `addComment` persists,
   then calls `routeCommentToAuthorSession` (`reviews.service.ts:209-212`), which
   picks the non-archived session whose `worktree_branch` matches the review's
   branch (`review-comment-delivery.service.ts:49-69`) and sends it a user-role
   message. The sender **resumes** the session —
   `resume: Boolean(session.provider_session_id)` (`session-message-sender.service.ts:110-113`)
   — so an agent that already exited comes back for the comment. Refusals are
   reported, never thrown: `no_session`, `session_busy`, `not_configured`,
   `failed` (`review-comment-delivery.service.ts:12-17`).

5. **The bridge has no review tools.** `AGENT_BRIDGE_TOOL_NAMES`
   (`agent-bridge.tools.ts:38-51`) covers tasks, maestro, messages and profiles —
   nothing for reviews. And `server/agent-bridge-mcp.test.ts:90` asserts the stdio
   surface declares exactly that list, so a new tool must be added in
   `server/agent-bridge-mcp.ts` too or the test fails.

6. **`prompt_agent` cannot currently run in a task's worktree.**
   `PromptAgentActionConfig.worktreePath` / `.worktreeBranch` are static strings
   in the rule's config (`automations.types.ts:82-84`), forwarded verbatim
   (`automation-actions.service.ts:50-57`). One rule serves every task on a board,
   so a static path is useless here — this is the one thing the carrier needs.

## Requirements

**Functional**

- When a card lands on `review` with a worktree, an agent posts review comments
  on the diff, and the review is waiting for a human.
- The reviewer **cannot approve**. No tool it can reach changes review state.
- The author agent receives the comments and can fix them.
- The comment → fix → re-review cycle terminates without a counter.
- An approval whose merge fails leaves a durable record on the review.

**Non-functional**

- No new action kind, no new trigger kind, no new stage, no migration.

## Architecture

### Carrier decision: an automation rule, not a hook in the reviews module

| Option | New machinery | Verdict |
| --- | --- | --- |
| New action kind `review_task` | widen the SQL `CHECK` on `action_kind` (`schema.ts:432-439`) → table-rebuild migration, validation, types, dispatcher, rule provisioning | rejected — the most expensive option, for nothing the others lack |
| Hook inside `reviews.module.ts` where `openReviewForTask` fires | reviews would need the org policy engine, session creation and a provider spawn path it does not have; all three already exist in automations | rejected — duplicates the spawn stack in a second module |
| **Existing `task_stage` trigger + existing `prompt_agent` action** | one optional boolean in the action config | **chosen** |

Everything the third option needs already exists: `task_stage` fires on
`toStage: 'review'` with an optional `project` filter
(`automation-triggers.service.ts:201-219`, validated at
`automations.validation.ts:157-168`), and `prompt_agent` already resolves the
account through the org policy engine. The only missing piece is insight 6.

```
card → review
  └─ emitTaskStageChanged                       tasks/task-stage-listeners.ts
       ├─ reviews.onTaskStageChanged            reviews.module.ts:79-84  → opens the review
       └─ automations.onTaskStageChanged        automation-triggers.service.ts:197
            rule "board-auto-review:{projectId}"  trigger task_stage {toStage:'review', project}
            dedupeKey  task:{id}:stage:review    ← fires once per card, ever
            action prompt_agent { useTaskWorktree: true, promptTemplate: <reviewer> }
              └─ runPromptAgent resolves the worktree from context.task.worktree_branch
                   guard: no live session on that branch
                   spawn (bridge-enabled by phase-07) in the task's worktree
                     agent: git diff base...branch, then review_comment_add(…) per finding
                       └─ reviews.addComment → routeCommentToAuthorSession
                            author session resumes, fixes, replies
                            human reads the thread → Approve  (human-only, JWT REST)
```

### Why the cycle terminates

By construction, with no counter and no new state:

- The reviewer fires on the **stage transition**, and `task_stage` dedupes on
  `task:{id}:stage:review` (`automation-triggers.service.ts:211`) — a key with no
  attempt or timestamp in it. `existsForDedupeKey` (`automations.service.ts:197`)
  therefore skips every later firing for that card, forever. **One first pass per
  card, ever.**
- `requestChanges` flips review state only; it never moves the card
  (`reviews.service.ts:264-295`). So the human asking for changes produces no new
  stage event and no second reviewer.
- The author's fixes arrive as messages into an existing session — they open no
  review and fire no trigger.
- Human approval ends it.

The cost of that simplicity is stated plainly: a card dragged out of review and
back does **not** get a second automated pass. That is the right default — a
second pass on a card the human already read is noise — and the human can always
comment themselves.

### Reviewer's write path: exactly one new bridge tool

The reviewer runs *inside the worktree*, so it reads the diff with git itself —
no tool needed for that, and no diff has to be squeezed through MCP. It only
needs to write:

```
review_comment_add({ taskId, filePath, lineNo?, body })
```

Keyed by **taskId, not reviewId**: the agent already knows its task id (it is in
the prompt), the live review is resolved server-side with
`taskReviewsDb.getLiveByTask` — the same lookup `openReviewForTask` uses
(`reviews.service.ts:133`) — and the bridge's existing `requireTaskInScope`
(`agent-bridge.maestro.tools.ts:60`, `agent-bridge.tool-input.ts`) then enforces
that the task is on the caller's own board. Nothing else is added: there is no
`review_approve`, no `review_request_changes`, no review-state tool of any kind,
so **approval is human-only by construction**, not by prompt discipline. The
approve route stays behind the UI's JWT (`reviews.routes.ts:49-55`).

## Related Code Files

**Modify**

| File | Change |
| --- | --- |
| `server/modules/automations/automations.types.ts` | `useTaskWorktree?: boolean` on `PromptAgentActionConfig` |
| `server/modules/automations/automations.validation.ts` | read the optional boolean (`:213-230`) |
| `server/modules/automations/services/automation-actions.service.ts` | `runPromptAgent` resolves the task's worktree when asked |
| `server/modules/agent-bridge/agent-bridge.tools.ts` | `review_comment_add` in the name list + dispatch |
| `server/modules/agent-bridge/agent-bridge.types.ts` | `AgentBridgeReviewsPort` |
| `server/modules/agent-bridge/agent-bridge.module.ts` | bind it to `reviewsService` |
| `server/agent-bridge-mcp.ts` | declare the tool on the stdio surface |
| `server/modules/reviews/reviews.service.ts` | `addCommentForTask` + conflict record in `approve` |
| `src/components/task-board/hooks/use-auto-pickup.ts` | provision the sibling review rule |
| `server/modules/agent-bridge/README.md`, `server/modules/reviews/` docs | the new tool, the first pass |

**Create**

- `server/modules/automations/tests/automation-reviewer-dispatch.test.ts`
- `server/modules/agent-bridge/tests/agent-bridge.review.tools.test.ts`

**File-ownership note.** `automations.types.ts` is owned by phase-05 and
`automation-actions.service.ts` by phase-06. This phase **must land after both**;
it cannot be developed concurrently with them. Everything else here is disjoint.

## Implementation Steps — A: the reviewer

1. **`useTaskWorktree` on `PromptAgentActionConfig`** (`automations.types.ts:69-85`):
   ```ts
   /**
    * Run in the worktree of the task that triggered the rule, rather than in
    * `projectPath`. One rule serves every card on a board, so the worktree
    * cannot be named in config — it is whatever the firing task is checked out
    * in. Ignored when the firing carries no task, or the task has no branch.
    */
   useTaskWorktree?: boolean;
   ```
   Opt-in, and it must stay opt-in: existing `prompt_agent` rules run in the main
   checkout today and silently relocating them would change behaviour nobody asked
   to change.

2. **Validation** — `automations.validation.ts:213-230` copies optional strings in
   a loop; add a separate optional-boolean read for `useTaskWorktree` beside it.

3. **`runPromptAgent`** (`automation-actions.service.ts:37-62`) — before the
   `promptAgent` call:
   ```ts
   let worktreePath = config.worktreePath ?? null;
   let worktreeBranch = config.worktreeBranch ?? null;
   if (config.useTaskWorktree && context.task?.worktree_branch) {
     worktreeBranch = context.task.worktree_branch;
     if (deps.agent.hasLiveSessionForBranch(worktreeBranch)) {
       return `Task ${context.task.id} already has a live agent session on ${worktreeBranch}; skipping`;
     }
     ({ worktreePath } = await deps.worktrees.ensureWorktree({
       projectPath: config.projectPath, branch: worktreeBranch, baseBranch: null,
     }));
   }
   ```
   The live-session guard is scoped to this new branch only — the author agent may
   still be finishing as the card lands, and two agents in one worktree is the
   failure phase-02's hardening already exists to prevent
   (`task-pickup.service.ts:75-81`). Returning a detail rather than throwing keeps
   it a clean skip, not three burnt retries.

4. **The reviewer prompt** — stored in the rule's `promptTemplate`, so it is data
   the operator can edit, not a string in the binary. Provisioned by step 6:
   ```
   Do a first-pass code review of task {{task.id}} ("{{task.title}}") on branch {{task.worktreeBranch}}.

   You are in the task's worktree. Read the change yourself with git — `git diff <base>...HEAD` against the branch the main checkout is on; `git log` for the intent.

   Post each finding with the review_comment_add tool: taskId {{task.id}}, the file path, the line number when you have one, and a body that says what is wrong and what to do about it. One comment per finding. If the change is sound, post one comment saying so and stop.

   Review what changed, not the whole codebase. Correctness, error handling, security, and anything that contradicts the task description come first; style opinions are noise here.

   You are the first pass, not the decision. You cannot approve and must not try: a human reads your comments and decides. Do not move the card, do not merge anything, do not push.
   ```

5. **`review_comment_add` in the bridge.**
   - `agent-bridge.types.ts`: `AgentBridgeReviewsPort { addCommentForTask(taskId, body): Promise<...> }`, added to `AgentBridgeToolDeps` (`:94-101`).
   - `agent-bridge.tools.ts`: add `'review_comment_add'` to `AGENT_BRIDGE_TOOL_NAMES`
     (`:38-51`) and a handler that reads `taskId` with `requireTaskInScope`, then
     `filePath` (optional — an empty path is the review-wide comment
     `reviews.service.ts:285`), `lineNo` (optional integer), `body` (required),
     and forwards to the port.
   - `reviews.service.ts`: `addCommentForTask(taskId, body)` — resolve the live
     review via `taskReviewsDb.getLiveByTask(taskId)`, 404 when there is none,
     then delegate to the existing `addComment` so persistence, `touch`,
     broadcast and author routing are all the same code path
     (`reviews.service.ts:193-215`). No second implementation.
   - `agent-bridge.module.ts`: bind the port to `reviewsService` (`:139-150`).
   - `server/agent-bridge-mcp.ts`: declare the tool, mirroring the `task_decompose`
     entry at `:171`. Required — `agent-bridge-mcp.test.ts:90` asserts parity.

6. **Provision the rule** in `use-auto-pickup.ts`. The hook already finds-or-creates
   `board-auto-pickup:{projectId}` (`:22-30`, `:110-126`); add a sibling
   `board-auto-review:{projectId}`, created and toggled by the **same** switch —
   one board setting, two rules:
   ```ts
   { name: `board-auto-review:${projectId}`,
     trigger_kind: 'task_stage',
     trigger_config: { toStage: 'review', project: projectId },
     action_kind: 'prompt_agent',
     action_config: { projectPath: fullPath ?? '', useTaskWorktree: true, promptTemplate: REVIEWER_PROMPT },
     enabled: true }
   ```
   Generalise the existing find/create/patch helpers over a rule descriptor rather
   than copying them — two near-identical blocks in one hook is how they drift.

## Implementation Steps — B: the merge gate

7. **Verify, do not change, the happy path.** Insights 1 and 2 are the answer to
   "does anything move the card to done": yes, `reviews.service.ts:249`, and the
   parent's branch is already the merge source. The smoke below is the deliverable.

8. **Make a failed merge durable** — the one gap. In `approve`
   (`reviews.service.ts:225-258`), wrap the `mergeWorktree` call:
   ```ts
   try {
     merge = await deps.mergeWorktree({ … });
   } catch (error) {
     // The merge aborted and rolled back, so the review is still live and the
     // button still works — but the reason exists only in this response. Write
     // it into the thread so it survives the dialog and reaches the author.
     await recordMergeFailure(deps, context, error);
     throw error;
   }
   ```
   `recordMergeFailure` creates a review-wide comment (empty `filePath`, the shape
   `requestChanges` already uses at `:285`) whose body names the target branch and
   the conflicted paths from the `AppError`'s `details`
   (`worktree-merge.service.ts:119-127`), then routes it with
   `routeCommentToAuthorSession` and broadcasts `'commented'`. Best effort and
   swallowed on failure: it must never mask the merge error it is reporting.
   Result: the conflict is in the thread, the card is untouched and still in
   `review`, and the author agent is paged to go fix it — the same
   comment→fix→re-review loop, reused.

9. **Tests.**
   - `automation-reviewer-dispatch.test.ts`: a `task_stage` firing with
     `useTaskWorktree` ensures the worktree for the task's branch and dispatches
     there; a live session on the branch is a clean skip with no dispatch; a
     firing with no task, or a task with no branch, falls back to `projectPath`;
     an existing `prompt_agent` rule **without** the flag is unaffected.
   - `agent-bridge.review.tools.test.ts` (style of
     `agent-bridge.maestro.tools.test.ts:21-107`): a comment lands on the task's
     live review; a task from another project answers 404; a task with no live
     review answers 404; the tool list contains no approve-like tool.
   - `reviews.service.test.ts`: a conflicting merge writes a review-wide comment,
     routes it, leaves the review live and the task's stage unchanged, and still
     throws.
   - `server/agent-bridge-mcp.test.ts` passes unmodified — it will only if step 5's
     stdio declaration is done.

## Todo List

- [ ] `useTaskWorktree` declared, validated, honoured (with the live-session guard)
- [ ] `review_comment_add` — types, dispatch, port, module binding, stdio surface
- [ ] `addCommentForTask` delegating to the existing `addComment`
- [ ] Sibling `board-auto-review:{projectId}` rule provisioned by the same toggle
- [ ] Reviewer prompt stored in the rule
- [ ] Merge failure recorded as a review comment and routed
- [ ] Tests: dispatch, bridge tool, no-approve-tool, conflict record
- [ ] Smoke A and B passed
- [ ] `Docs impact:` bridge README tool table + reviews docs
- [ ] `npm run build:server` && `npm run typecheck` && `npm run lint` && `npm test` clean

## Smoke

**A — the first pass**

1. Auto-pickup on. `GET /api/automations` shows both rules for the project.
2. Let a ticket run through to `review`. Within seconds a reviewer session starts
   **in the task's worktree** (not the main checkout).
3. Comments appear on the review in the Review Center, on real files and lines.
4. The Review Center still shows Approve as available to the human, and the
   reviewer session never changed the review's state.
5. The author session receives the comments — check its transcript. If it had
   exited, it resumed (insight 4).
6. After the author fixes and replies, no second reviewer starts. Drag the card
   out of review and back: still no second pass (dedupe key), and the review
   thread is reused rather than forked (`reviews.service.ts:133-143`).
7. Turn the toggle off: a new card reaching review gets no reviewer.

**B — the merge gate**

8. Approve a solo ticket's review. The branch merges into the main worktree's
   branch, the card moves to `done`, the review closes.
9. Approve a **decomposed parent's** review: `git log` on the base branch shows
   the parent's merge commit and, beneath it, every subtask's work. One merge, one
   card to `done`.
10. Force a conflict: change the same line on the base branch, then approve.
    Expect — a 409 naming the conflicted files; the base worktree clean and
    unchanged (`git status`); the review still live; a new review-wide comment in
    the thread naming the conflict; the author session paged. Press Approve again
    after resolving: it succeeds.
11. Approve with the task row deleted underneath: the merge still lands and the
    response carries `taskUpdateError` (`reviews.service.ts:246-253`) rather than
    reporting a failed approval.

## Success Criteria

- Every card reaching review gets exactly one agent pass, and every approval is
  still a human action.
- No tool reachable by an agent can approve a review.
- An approval that cannot merge leaves a comment behind, and the base branch is
  byte-identical to what it was before the attempt.
- Approving a decomposed parent puts all of its subtasks' work on the base branch
  in one merge.

## Risk Assessment

| Risk | L×I | Mitigation |
| --- | --- | --- |
| Reviewer joins the worktree while the author agent is still running | Med×High | `hasLiveSessionForBranch` guard in step 3; the pass is skipped, not queued |
| Reviewer posts dozens of low-value comments | Med×Med | Prompt scopes it to the diff and to correctness/security; the prompt is rule data and editable without a deploy |
| One pass per card, ever — a re-entered card gets none | Med×Low | Deliberate, documented; the human can comment. Revisit only if the smoke says it hurts |
| `useTaskWorktree` accidentally applied to existing rules | Low×High | Opt-in flag, default off; a test asserts unflagged rules are unaffected |
| `review_comment_add` used to spam another project's review | Low×High | `requireTaskInScope` — the same token scoping every other bridge tool uses |
| Conflict comment fails to write and masks the merge error | Low×Med | Wrapped and swallowed; the merge error is always what propagates |
| Stdio surface not updated → tool invisible to agents | Med×Med | `agent-bridge-mcp.test.ts:90` fails the build if it is missed |
| Reviewer fires for a subtask a human dragged to review | Low×Low | Harmless — it reviews a real branch. Not filtered |

## Rollback

Disable or delete the `board-auto-review:*` rules first — a stored rule with
`useTaskWorktree` read by reverted code simply ignores the flag and runs in the
main checkout, which is safe. Then revert the bridge tool (the stdio declaration
and the tool list must go together) and the reviews change. The conflict-comment
change is independent of everything else here and can stay.

## Security Considerations

- **Approval stays human-only two ways**: no agent-reachable tool changes review
  state, and `/api/reviews/:id/approve` is behind the UI's JWT
  (`reviews.routes.ts:49-55`). The bridge's token is a different credential with a
  different derivation and reaches only `/api/agent-bridge`.
- The reviewer reads a diff written by another agent and interpolates none of it
  into a privileged context — it writes comments, which are data.
- `review_comment_add` is scoped by the session token like every other bridge
  tool; a task id from another project answers 404, never 403, so a board cannot
  be probed for ids.
- Comment bodies reach `validateCommentBody` (`reviews.service.ts:202`) on the
  same path a human's comment does.

## Next Steps

- `Docs impact:` **minor** — bridge README tool table, reviews module notes.
- Follow-ups, none planned: a second automated pass on re-entry; reviewer findings
  as structured severities; auto-request-changes when the reviewer finds something
  serious (deliberately *not* done — it would take the decision away from the human).

## Unresolved Questions

1. Should the reviewer rule be a separate board toggle rather than riding on
   Auto-pickup? Riding along is fewer controls and matches "close the loop"; a
   separate switch is one more thing to explain. Default in this plan: one toggle,
   two rules.
2. Should the reviewer be skipped for cards a human moved to review by hand (as
   opposed to an agent)? The trigger cannot currently tell them apart, and adding
   that distinction means a new signal. Default: review both.
