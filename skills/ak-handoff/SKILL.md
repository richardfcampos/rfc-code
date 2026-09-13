---
name: ak:handoff
description: Create a portable, redacted Markdown continuation contract that a fresh coding agent can consume to resume in-progress work safely. Use when switching sessions, models, or runtimes, or when preserving decisions, verification state, and blockers.
user-invocable: true
when_to_use: Invoke to capture a session's continuation contract for a successor agent. For a human-facing status report derived from branches, worktrees, plans, and repository history, use ak-watzup instead.
category: utilities
keywords: [handoff, session, continuation, decisions, blockers, redaction]
license: MIT
argument-hint: "[task focus] [--output PATH] [--include-diff] [--include-status] [--force]"
metadata:
  author: agentkit
  version: "2.0.0"
  upstream: "Pinned MIT source archive: handoff@ce70edaa26247b84c2b9491a0cdb4964f65cf3a5 (rewritten for AgentKit v2 contract)"
---

# Handoff

Create one Markdown artifact that lets a fresh coding agent resume in-progress
work with minimal rediscovery. The artifact is a **continuation contract**:
mission, guardrails, live state, decisions, verification, blockers, and the
exact next safe action — never a transcript dump, never invented context.

This skill is a documentation/capture surface only. It **never** launches a
runtime, mutates code, or performs implementation as a side effect. That
composition belongs to [`ak:handover`](../ak-handover/SKILL.md).

## Boundary vs `ak:watzup`

- `ak:handoff` = continuation contract for a **successor agent**. Session
  reasoning, decisions, verification state, exact next actions.
- `ak:watzup` = status report for a **human**, derived from branches,
  worktrees, plans, and repository history.

When in doubt: is the reader another AI agent about to continue this exact
task? Handoff. A human wanting to know where the project stands? Watzup.

## Inputs

Accepted forms:

```bash
/ak:handoff
/ak:handoff "continue the OAuth callback fix"
/ak:handoff --output plans/handoffs/oauth-callback.md
/ak:handoff --include-diff --include-status
/ak:handoff --force --output plans/handoffs/oauth-callback.md
```

Flags:

| Flag | Effect |
| --- | --- |
| _(bare)_ | Capture the current session's continuation contract with an auto-derived slug. |
| `[task focus]` | Optional single-string focus for the successor agent. Included in the Mission section and the artifact filename slug. |
| `--output PATH` | Explicit artifact path. Must resolve inside the workspace root; parent directory is created if it does not exist; the auto-derived slug/timestamp is not applied; `--force` is still required to overwrite an existing file at that path. |
| `--include-diff` | Append a bounded diff summary (`git diff --stat` + first 200 lines of `git diff`, redacted, truncation explicitly marked). |
| `--include-status` | Append a `git status --short` snapshot, redacted. |
| `--force` | Allow overwriting an existing artifact at the target path. Refuse otherwise. |

## Output Location

**Write path** (single canonical destination):

```text
plans/handoffs/<slug>-<YYYYMMDD-HHmm>.md
```

- Slug is derived from the `[task focus]` string when provided, otherwise
  from the branch name or a short summary of the goal.
- Create `plans/handoffs/` under an existing `plans/` root when it does not
  exist yet.
- If the project has no `plans/` root at all, ask the user for a safe output
  location before writing.
- Never write outside the project workspace.

**Discovery** (when reading prior handoffs to inform the current one):

- Scan `plans/handoffs/*.md` first.
- Also scan legacy `plans/reports/handoff-*.md` so muscle memory from earlier
  AgentKit versions keeps working.

## Required Artifact Structure

Every handoff document contains these nine H2 sections in this order — the
schema is validated by `ak:handover` before dispatch. See
[references/artifact-schema.md](references/artifact-schema.md) for the exact
Markdown template.

1. **Mission and current status** — desired outcome, what is done, what
   remains, urgency/priority when known.
2. **Scope and guardrails** — repository/workspace, permitted and prohibited
   changes, user constraints, safety boundaries.
3. **Current state** — branch, HEAD, worktree, changed/untracked files,
   relevant paths, whether local modifications are intentional.
4. **Decisions and rationale** — decisions made, alternatives rejected, links
   to specs/issues/PRs/ADRs.
5. **Work performed** — changes made, commands executed, meaningful
   outputs/errors. Secrets redacted.
6. **Verification** — checks run with outcome; checks not run and why;
   known failures or flaky behavior.
7. **Open risks and blockers** — unresolved questions, dependencies, review
   requirements, external approvals.
8. **Exact next actions** — ordered, executable steps; identify the first
   safe step (marker: `**First safe step**`).
9. **Source pointers** — paths and URLs needed to validate or continue. Do
   not fabricate unavailable context.

For any section with no trustworthy information, write literally
`Not captured in this session` rather than inventing content or leaving the
heading empty. Never remove a required heading.

## Capture Rules

**Live workspace evidence** — probe read-only, one command at a time, before
drafting Current state:

- `git rev-parse --is-inside-work-tree` (detect missing repo, fall through
  to a repo-less handoff below)
- `git rev-parse --show-toplevel`
- `git rev-parse --abbrev-ref HEAD`
- `git rev-parse HEAD`
- `git status --short` (bounded; if the list exceeds 200 entries, include
  the first 200 and mark `… truncated at 200 entries …`)
- `git diff --stat` (only when `--include-diff`)
- `git diff` (only when `--include-diff`, bounded to first 200 lines,
  `… truncated at 200 lines …` marker appended after truncation)

Distinguish observed facts (from probes) from agent/user assertions (from
session context).

**Missing git repository** — capture works without a repo: state
`Not captured in this session` for Current state git fields, keep the section
present, and continue.

**Session context** — decisions, user constraints, commands already
performed. Never dump raw transcripts. Never expose hidden reasoning. Capture
only task-relevant, actionable facts.

**Empty/new workspace** — do not fabricate repo history, file names, or
commands. Report only what exists.

## Redaction

Every artifact and every appended `--include-diff` / `--include-status`
block passes through redaction before write. See
[references/redaction-patterns.md](references/redaction-patterns.md) for the
pattern catalog.

Categories always redacted:

- API keys, tokens, JWTs, session cookies
- Private keys (PEM blocks, SSH private keys)
- `.env` values (KEY=VALUE where KEY looks credential-like)
- Passwords, database URLs with credentials
- Private URLs (internal/staging hosts, signed URLs with query tokens)
- Customer/personal data captured incidentally

Replacement is a stable marker like `[REDACTED:aws-key]` or `[REDACTED:jwt]`
(counted, not raw). If the `[task focus]` string itself contains a
credential-looking value, refuse the invocation and ask the user to rephrase.

## Collision Guard

- If the target path already exists and `--force` is absent, refuse with an
  explicit message showing the existing file's mtime and suggesting either
  `--force` or a different `--output`.
- Overwrite only when `--force` is passed explicitly; `--force` is not
  implied by `--output`.
- Never rename or delete an existing artifact silently.

## Return Value

After successful write, print:

1. The absolute artifact path.
2. A single-line continuation instruction the user can copy into the next
   session, of the shape:
   `Read <path> and verify the Current state section against the repo before acting.`

Do not print the artifact body inline.

## Security & Boundaries

- Never launch a coding runtime, subagent, or CLI as a side effect. This
  skill only reads workspace state and writes one Markdown file.
- Never make git commits, edits, deletions, or config changes.
- Never write outside the project workspace or the chosen artifact path.
- Never include raw transcripts, chain-of-thought, or hidden reasoning.
- The task focus string is included verbatim in the Mission section; if it
  contains credentials, refuse the invocation.

## Scenarios

The scenarios below define expected behavior. They double as review fixtures
for the `--advice` post-implementation gate.

### Scenario 1 — Clean git workspace, bare invocation

**Given** a clean workspace on a feature branch, no `plans/handoffs/` yet.
**When** `/ak:handoff` runs with no arguments.
**Expect** `plans/handoffs/` created; artifact written with an
auto-derived slug + timestamp; all nine sections present; Current state
records branch/HEAD/"working tree clean"; Verification section states
"Not captured in this session" for anything unverified; return prints the
path + continuation instruction.

### Scenario 2 — Dirty workspace with `--include-diff --include-status`

**Given** modified files and untracked files exist.
**When** `/ak:handoff --include-diff --include-status` runs.
**Expect** Current state lists changed/untracked files; Work performed cites
executed commands; a redacted diff summary appears with `… truncated at 200
lines …` when the raw diff exceeds the limit; a `git status --short`
snapshot appears, redacted.

### Scenario 3 — Missing git repository

**Given** the current directory is not inside a git repo.
**When** `/ak:handoff` runs.
**Expect** the artifact still writes; Current state section is present with
`Not captured in this session` for the git-derived fields; no `git` command
runs beyond the initial `rev-parse --is-inside-work-tree` probe.

### Scenario 4 — Secret redaction fixture

**Given** the session captured a command output containing (fake) values
like `AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` and a
line `Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.sig-fake`
(three base64url-shaped segments so the JWT regex actually matches).
**When** `/ak:handoff` runs.
**Expect** the artifact contains `[REDACTED:aws-key]` and `[REDACTED:jwt]`
markers respectively; no raw secret value appears anywhere; the total number
of redactions applied is mentioned in Work performed.

### Scenario 5 — Explicit `--output` path

**Given** the user passes `--output plans/handoffs/oauth-callback.md`.
**When** `/ak:handoff --output plans/handoffs/oauth-callback.md` runs.
**Expect** the artifact is written to that exact path (parent created if
needed); the auto-derived slug/timestamp is not applied; the return prints
the same explicit path.

### Scenario 6 — Collision without `--force`

**Given** `plans/handoffs/oauth-callback.md` already exists.
**When** `/ak:handoff --output plans/handoffs/oauth-callback.md` runs
without `--force`.
**Expect** refusal with a message showing existing-file mtime; no write
occurs; suggestion to pass `--force` or choose a different path. Rerunning
with `--force` overwrites the file.

## Non-goals

- No runtime dispatch, prompt assembly for another agent, or preflight — use
  [`ak:handover`](../ak-handover/SKILL.md).
- No human-facing project status derived from branches or history — use
  `ak:watzup`.
- No plan authoring or ADR minting — use `ak:plan` or the docs skills.
