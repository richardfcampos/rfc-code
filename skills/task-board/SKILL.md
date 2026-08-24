---
name: task-board
description: Create and manage tasks on rfc-code's native project task board (Backlog/In progress/Review/Done) through the agent-bridge MCP tools. Use whenever a session inside rfc-code should track its own work as a task, hand off a follow-up, log progress notes/links, or check what's queued for the current project.
user-invocable: true
when_to_use: "Invoke when an agent session running inside rfc-code needs to create, update, move, or log evidence against a task on the project's board."
category: dev-tools
keywords: [task-board, kanban, agent-bridge, mcp, rfc-code, task-management, evidence, handoff]
license: MIT
argument-hint: "[task title or task id]"
metadata:
  author: rfc-code
  version: "1.0.0"
---

# Task Board Skill

Drive rfc-code's native task board — the "Board" tab every project has — from inside
a running agent session, through the `agent-bridge` MCP server. No file to write,
no TaskMaster init: the board is native SQLite state, and the bridge is registered
automatically for every session that spawns from rfc-code.

## When to Use

- The user asks you to track something as a task, or to "add this to the board."
- You are about to do multi-step work and want a visible record of progress
  (create the task, move it through stages as you go, log evidence).
- You want to hand off a follow-up to whoever picks up the project next —
  create a task with `origin: 'agent'` instead of leaving it only in chat.
- You need to check what is already queued or in review for this project
  before starting new work (`task_list`).
- You want to reference a file, PR, or external resource you produced —
  log it as evidence instead of only mentioning it in the transcript.
- You need an account profile recommendation before doing work that
  consumes API quota (`profile_recommend`).

Skip this skill for anything that is not project-task tracking — it does not
replace TaskMaster (PRD-driven task generation) and it has no opinion on how
you should do the underlying work, only on recording it.

## Availability

The bridge is scoped per session: when this session was spawned, rfc-code minted
a bearer token for `{ sessionId, projectPath }` and registered an MCP server
(`cloudcli-agent-bridge` or similarly named) with these tools already available
to you. If the tools below do not show up in your tool list, the bridge was not
registered for this session — that is a host-side configuration gap, not
something to work around; tell the user instead of trying to call the REST API
directly (the token is not exposed to you as a plain credential).

## Available Tools

| Tool | Input | Effect |
| --- | --- | --- |
| `task_create` | `title`, `description?`, `suggested_skill?` | Creates a task with `origin: 'agent'` and this session's id as `origin_detail` |
| `task_list` | `stage?` | Lists this project's tasks, optionally filtered to one stage |
| `task_update_stage` | `taskId`, `stage` | Moves a task between `backlog` / `in_progress` / `review` / `done` |
| `task_update_description` | `taskId`, `description` | Sets a task's markdown description (rendered in the board's detail view) |
| `task_assign` | `taskId`, `profileId` | Assigns an account profile — refused (403) when the org's policy denies that profile for this project |
| `task_evidence_add` | `taskId`, `kind` (`note`\|`link`), `content` | Appends a work-log entry to the task's evidence list |
| `profile_recommend` | `provider?` | Returns the profile this project should use next, quota-aware |

Every tool is scoped to this session's project — you never pass a project name,
and a task id from another project answers 404 instead of leaking cross-project
data.

## Core Workflow

1. **Starting multi-step work** — create the task up front so progress is visible:
   ```
   task_create({ title: "Add rate limiting to /api/upload" })
   → { task: { id: "…", stage: "backlog", origin: "agent", … } }
   ```
2. **Picking it up** — move it forward before you start, not after:
   ```
   task_update_stage({ taskId: "<id>", stage: "in_progress" })
   ```
3. **Recording context as you go** — a short description of the approach, and
   evidence for anything worth pointing back to later:
   ```
   task_update_description({ taskId: "<id>", description: "Token-bucket per user, 10 req/min. See src/middleware/rate-limit.ts." })
   task_evidence_add({ taskId: "<id>", kind: "note", content: "Chose token-bucket over fixed-window — smoother burst handling." })
   task_evidence_add({ taskId: "<id>", kind: "link", content: "src/middleware/rate-limit.ts" })
   ```
   `link` content is free text — a URL or a repo-relative file path both work;
   the board renders it as a clickable link only when it looks like `http(s)://`.
4. **Handing off or wrapping up** — move to `review` when the work needs a
   second look, or straight to `done` when it doesn't:
   ```
   task_update_stage({ taskId: "<id>", stage: "review" })
   ```
5. **Checking what else is queued** before starting unrelated work:
   ```
   task_list({ stage: "backlog" })
   ```

## Org/Profile Notes

- `task_assign` and any profile-consuming action go through the same org policy
  resolver as the rest of rfc-code. A profile outside the project's org policy
  is refused with a named 403 — do not retry with the same profile, surface the
  refusal to the user instead.
- `profile_recommend` is quota-aware: call it before kicking off work that will
  burn through an account's usage, especially if you are about to hand a task
  to a `primary` profile that might already be near its threshold. It returns
  a `fallback` reason when a fallback was substituted — worth mentioning to the
  user rather than silently proceeding.
- Uploading a file as an attachment is out of scope for the bridge (no
  multipart support over MCP). If you produced a file worth attaching, log it
  as `kind: 'link'` evidence with the file's path — a human can upload the
  actual bytes from the board's detail view later.

## Anti-Patterns

- Creating a task for every trivial one-shot action — this adds board noise
  without adding visibility. Reserve it for work that spans multiple turns or
  that someone else might need to pick up.
- Calling `task_assign` speculatively "to see what happens" — a denied
  assignment is a policy signal, not a retry loop.
- Writing evidence `content` longer than a few sentences — the field caps at
  10,000 characters server-side, and long-form writeups belong in the task
  description instead, where they render as markdown.
