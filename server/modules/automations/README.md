# Automations

Rules that turn an event into work: a clock, a card changing column, an inbound
request or a plan-usage reading fires an action — prompt an agent, create a task
or send a push notification.

Every firing is **idempotent** (the event's identity is stored with its history,
and one event executes once), **retried but bounded** (three attempts, growing
pause, every attempt recorded) and **auditable** (`GET /:id/runs`).

## Layout

| File | Role |
| --- | --- |
| `automations.module.ts` | Composition root — the only file that touches real storage, the policy engine, the board and the provider runtimes |
| `automations.service.ts` | Firing engine: dedupe, retry, history |
| `services/automation-triggers.service.ts` | The four trigger sources; each names the event that made a rule due |
| `services/automation-actions.service.ts` | The three actions, one attempt each |
| `services/automation-agent-spawn.service.ts` | Server-initiated runs (session + registry + provider dispatch) |
| `services/automation-scheduler.service.ts` | One minute-aligned interval for the whole installation |
| `services/cron-expression.ts` | Five-field cron matcher (minute granularity, local time) |
| `services/automation-webhook-secret.ts` | Secret generation, hashing and constant-time verification |
| `automations.routes.ts` | REST: management (JWT) and inbound webhook (secret) |

## REST

Mounted by the entrypoint as `/api/automations` (behind `authenticateToken`) and
`/api/automations/webhook` (no JWT — authenticated by the rule's own secret).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/automations` | List rules (secrets never included) |
| `POST` | `/api/automations` | Create; returns `secret` once for webhook rules |
| `GET` | `/api/automations/:id` | One rule |
| `PATCH` | `/api/automations/:id` | Partial update; re-validates config against its kind |
| `DELETE` | `/api/automations/:id` | Delete (history cascades) |
| `GET` | `/api/automations/:id/runs?limit=` | Execution history, newest first (limit 1–200, default 50) |
| `POST` | `/api/automations/:id/fire` | Fire by hand, ignoring the trigger and the dedupe key |
| `POST` | `/api/automations/:id/webhook-secret` | Rotate the webhook secret |
| `POST` | `/api/automations/webhook/:id` | Inbound webhook (see below) |

The webhook presents its secret as `X-Automation-Secret: <secret>` or
`Authorization: Bearer <secret>`, and may identify a delivery with
`X-Idempotency-Key` (or a `dedupeKey` field in the body) so a repeated delivery
is skipped instead of fired again. Every refusal is the same 401, whatever the
reason — the endpoint cannot be used to discover which rules exist.

## Trigger configs

```jsonc
// cron — five fields, minute granularity, server local time
{ "cron": "0 3 * * *" }

// task_stage — fires once per task per transition into `toStage`
{ "toStage": "in_progress", "fromStage": "backlog", "project": "my-app" }

// webhook — server-owned; the secret is minted on create/rotate, never accepted
{}

// quota_threshold — evaluated on the minute tick
{ "profileId": "…", "thresholdPct": 85, "cooldownMinutes": 60 }
```

## Action configs

```jsonc
// prompt_agent — the resolver picks the account; `profileId` only narrows it
{
  "projectPath": "/home/dev/my-app",
  "provider": "claude",              // optional, defaults to claude
  "promptTemplate": "Pick up {{task}} ({{task.id}})",
  "profileId": "…",                  // optional, still checked by the org policy
  "skill": "debug",                  // optional, appended as an instruction
  "worktreePath": "…",               // optional, pins the run to a worktree
  "worktreeBranch": "…"
}

// create_task — origin is forced to `automation`, stamped with the rule's name
{ "project": "my-app", "title": "Review {{task}}", "description": "…",
  "suggestedSkill": "review", "assigneeProfileId": "…" }

// notify_push — recipient defaults to the installation's first active user
{ "message": "{{task}} reached {{task.stage}}", "userId": 1 }
```

## Template placeholders

`{{automation.name}}`, `{{automation.id}}`, `{{firedAt}}` are always available.
Unknown placeholders render as an empty string.

| Trigger | Placeholders |
| --- | --- |
| `task_stage` | `{{task}}` (title), `{{task.id}}`, `{{task.title}}`, `{{task.description}}`, `{{task.stage}}`, `{{task.previousStage}}`, `{{task.project}}`, `{{task.skill}}`, `{{task.assignee}}`, `{{task.worktreeBranch}}` |
| `webhook` | `{{payload.<field>}}` for each scalar top-level field of the request body |
| `quota_threshold` | `{{quota.profileId}}`, `{{quota.usagePct}}`, `{{quota.thresholdPct}}` |

## What `prompt_agent` does, precisely

It creates a real app session (`sessions` row), resolves the account through the
org policy engine, registers a run in the chat run registry and dispatches to the
provider runtime. It resolves at **dispatch**, not at completion: the history
records that the work was started and on which session, and the run itself is
watchable in the UI by subscribing to that session. Retries therefore cover
dispatch failures (denied account, unavailable provider, session busy) and never
re-prompt an agent that is already working.
