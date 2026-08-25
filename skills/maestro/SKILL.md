---
name: maestro
description: Run a task as the leader of a team of agent sessions inside rfc-code — break it into subtasks with dependencies, delegate each one to a worker session with a policy-approved account profile, track acknowledgements in the handoff inbox, and close the parent when every subtask lands. Use when a task is too big for one session or splits cleanly into parallel work.
user-invocable: true
when_to_use: "Invoke when an agent session inside rfc-code should lead other sessions on a task instead of doing all of it itself: planning subtasks, handing them out, and following up on acks."
category: dev-tools
keywords: [maestro, orchestration, delegation, subtasks, dependencies, agent-bridge, mcp, rfc-code, handoff, task-board]
license: MIT
argument-hint: "[parent task id or the task to decompose]"
metadata:
  author: rfc-code
  version: "1.0.0"
---

# Maestro Skill

Lead a task instead of doing all of it: decompose it on rfc-code's native board,
hand the pieces to worker sessions, and follow up. Everything you plan is stored
on the board through the `agent-bridge` MCP server — you are not the only copy of
the plan, so a leader that dies mid-flight can be replaced by one that reads the
board.

Read the `task-board` skill first if you have not used the board tools before;
this skill assumes `task_list`, `task_update_stage` and `task_evidence_add`.

## When to Use

- A task has three or more parts that can be worked separately, especially when
  some can run in parallel.
- Parts have a real order between them (schema before the API that reads it) and
  you want that order enforced rather than remembered.
- You want other sessions doing the work while you keep the overview: budget,
  quota, review, and what is left.

Skip it when the work is one coherent change in one place — decomposing a
two-step task costs more coordination than it saves, and a plan with one subtask
in it is noise on somebody's board.

## Available Tools

| Tool | Input | Effect |
| --- | --- | --- |
| `task_decompose` | `parentTaskId`, `subtasks: [{ title, description?, skill?, dependsOn?: number[] }]` | Creates the whole plan at once under a parent task |
| `task_ready_list` | `parentTaskId` | Subtasks that can start right now |
| `task_delegate` | `taskId`, `toSessionId?`, `profileId?` | Assigns the task and queues a handoff message to a worker session |
| `message_list` | `box?`, `state?` | Your mailbox — how you see acks and answers |
| `task_list` | `stage?` | The whole board, to check what landed |
| `task_update_stage` | `taskId`, `stage` | Moves the parent (or a subtask) between stages |

`dependsOn` holds **positions in the same `subtasks` array**, because the
subtasks have no ids until they are written. `[0, 1]` on the third entry means
"this one waits for the first two".

## The Loop

1. **Decompose** — one call, the whole plan. It is atomic: if any entry is
   invalid the board stays exactly as it was, so fix and resend rather than
   patching a half-written plan.
   ```
   task_decompose({
     parentTaskId: "<parent id>",
     subtasks: [
       { title: "Add the imports table + migration", skill: "databases" },
       { title: "Importer service on top of it", dependsOn: [0] },
       { title: "Board column for import status", dependsOn: [0] },
       { title: "End-to-end test of a real CSV", dependsOn: [1, 2] }
     ]
   })
   → { parent, subtasks: [...], dependencies: [...] }
   ```
2. **Ask what is startable** — never guess from your own plan; stages move
   underneath you while you work.
   ```
   task_ready_list({ parentTaskId: "<parent id>" })
   → { subtasks: [ { id, title, suggested_skill, … } ] }
   ```
3. **Delegate each ready subtask** to a worker session. Omit `profileId` unless
   you have a reason: the server then picks a policy-approved, quota-aware
   profile and records why on the task.
   ```
   task_delegate({ taskId: "<subtask id>", toSessionId: "<worker session id>" })
   → { task, message, recommendation }
   ```
   The worker receives a handoff carrying the task id, title, description and
   suggested skill, and is asked to acknowledge it.
4. **Track acknowledgements** — reading your inbox is what marks messages
   delivered, and workers `message_ack` when they pick work up and
   `message_answer` when they are done.
   ```
   message_list({ box: "outbox" })   → what you sent and where each stands
   message_list()                    → replies and questions addressed to you
   ```
   A handoff still `queued` or `delivered` long after you sent it means the
   worker never picked it up: re-delegate to somebody else rather than waiting.
5. **Repeat from 2** as subtasks land — finishing one usually releases others.
6. **Close the parent** when `task_list` shows every subtask `done`: move the
   parent to `review` (a human decides it is really finished) and log a short
   evidence note pointing at what was produced.

## Rules That Are Enforced For You

- **Blocked work cannot be delegated.** A subtask whose dependencies are not all
  `done` is refused, and the refusal names what it is waiting on. That is why
  step 2 exists — do not try to route around it.
- **Nesting is refused.** A subtask cannot itself be decomposed; if a piece
  turns out to be too big, decompose the *parent* differently or create a
  sibling task.
- **Off-policy profiles are refused** (`403`, with the reason). Do not retry the
  same profile — either omit `profileId` and take the recommendation, or tell
  the user the org policy is in the way.
- **A dead recipient fails the handoff, not the assignment.** If `task_delegate`
  errors with an unknown recipient, the task is still assigned; delegate it to a
  live session and move on.
- **Subtasks inherit the parent's project.** You cannot plan work onto another
  project's board, and a task id from another project reads as "not found".

## Anti-Patterns

- Decomposing work you are going to do yourself anyway — the plan is for other
  sessions; a solo agent should just use `task-board`.
- Declaring dependencies "to be safe". Every edge you add serializes work that
  could have run in parallel; only add one when the second task genuinely cannot
  start without the first.
- Delegating everything at once to the same worker session — one session working
  four subtasks in sequence is slower than it looks and loses the parallelism the
  plan was for.
- Moving the parent to `done` yourself. `review` is the honest stage: you know
  the subtasks landed, not that the whole thing is right.
- Sending long instructions in the handoff body instead of putting them in the
  subtask description at decompose time. The description survives; a message is
  read once.
- Polling `message_list` in a tight loop. Check it when you have something else
  to do — between delegations, or after a subtask lands.
