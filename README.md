<div align="center">
 <img src="public/favicon.svg" alt="RFC Code" width="72" height="72">
 <h1>RFC Code</h1>
 <p>A self-hosted control room for coding agents.<br>Run Claude Code, Codex, Cursor CLI and OpenCode from one browser tab, on desktop or phone, against the projects on your own machine.</p>
</div>

<div align="center">
<img src="public/screenshots/desktop-main.png" alt="RFC Code chat view" width="800">
</div>

RFC Code is a personal, single-maintainer project. It started in 2026 as a fork of [CloudCLI UI](https://github.com/siteboon/claudecodeui) and has since been rebuilt around a different idea: not a chat window in front of one CLI, but a workspace where several agents, several accounts and several worktrees work on the same projects and you review what they did. The upstream attribution is kept in [License](#license) as AGPL-3.0 requires; RFC Code is not affiliated with or endorsed by CloudCLI or Siteboon.

## What it does

**Agents and accounts**
- Drives four agent CLIs through one chat: Claude Code, Codex, Cursor CLI and OpenCode. One model picker across providers, one session list, one permission model.
- Account profiles: several accounts per provider, each with its own isolated config directory, skills and hooks. Sessions run as a chosen profile, and a running session can be handed to another account between turns. Same provider keeps the native transcript; a different provider gets a summarized primer.
- Voice input and read-aloud through any OpenAI-compatible audio backend (OpenAI, Groq, or a local Speaches / LocalAI / Kokoro server).

**Work, not just chat**
- Task board: TaskMaster kanban with a real review column, task drawer with description, attachments and evidence log, decomposition into subtasks with dependencies, live refresh when `tasks.json` changes on disk.
- Review cockpit: a queue of finished tasks with per-line diff comments, approve-and-merge, and request-changes that sends feedback back to the agent. Its UAT block boots the project's dev server on a tailnet-reachable port so you can click through the change before merging.
- Overview: every running session, task and board across all projects on one page, with deep links into a task or its review.
- Worktrees from the UI: create, work in and merge git worktrees. A new worktree gets the project's untracked skills, its gitignored agent config (`CLAUDE.md`, `.cursor/`, `.mcp.json`) symlinked back, a non-colliding branch name and, when the source repo is indexed, its own CodeGraph index.
- Source control tab: stage, commit, push, branches and worktrees; file explorer with an editor; a shell into the project.

**Agents working together**
- Collab: debate, review, vote or council rounds between Claude and Codex participants, with a per-run token, turn and timeout budget. Council turns carry a structured contract (evidence, risks, tests, disagreements, confidence) that is summarized above the transcript.
- Team view: a live graph of running sessions and the handoff messages flowing between them.
- Agent bridge: an MCP server every session gets, through which an agent drives its project's task board, decomposes and delegates work, sends and answers handoff messages and picks a profile. A `maestro` skill is bundled for leader sessions and a `task-board` skill for workers.
- Automations: cron, board-column change, inbound webhook and plan-usage triggers that prompt an agent, create a task or push a notification. Idempotent, retried, auditable.
- Notifications: per-project phone pushes through a self-hosted [notify-hub](https://github.com/richardfcampos/notify-hub) when a session finishes or needs you, and signed session webhooks for other agents (see below).
- Remote control: an embedded MCP server (Grokbot MCP) with ~200 tools, a `rfc` CLI for one-line session summaries, and webhooks that fire when a session finishes — built so an external agent spends hundreds of bytes, not kilobytes, per check.

**Batteries included**
- CodeGraph: projects show whether a `.codegraph/` index exists, with click-to-index. `AGENTS.md` tells every agent to query the graph before grepping.
- 145 bundled skills in [`skills/`](skills/README.md) (the AgentKit Engineer kit plus gstack and a set of specialist skills) and the kit's agents, rules, hooks and output styles in [`agent-kit/`](agent-kit/README.md), linked into each profile and toggled per profile.
- Extra project directories, like the CLI's `--add-dir`, so an agent can see a sibling repo.
- Browser tab for agent-driven browsing sessions, and the upstream plugin system for custom tabs.

## Screenshots

Dark mode, with session titles and message content scrambled.

<table>
<tr>
<td align="center"><img src="public/screenshots/overview.png" alt="Overview" width="420"><br><em>Overview: sessions, tasks and boards across projects</em></td>
<td align="center"><img src="public/screenshots/tasks-board.png" alt="Task board" width="420"><br><em>Task board with review column and dependencies</em></td>
</tr>
<tr>
<td align="center"><img src="public/screenshots/collab.png" alt="Collab" width="420"><br><em>Collab: multi-agent rounds with budget and verdict</em></td>
<td align="center"><img src="public/screenshots/source-control-worktrees.png" alt="Source control" width="420"><br><em>Source control with worktrees</em></td>
</tr>
<tr>
<td align="center"><img src="public/screenshots/cli-selection.png" alt="Model picker" width="420"><br><em>One model picker across providers</em></td>
<td align="center"><img src="public/screenshots/tools-modal.png" alt="Settings" width="420"><br><em>Settings: per-agent account, permissions, MCP servers and skills</em></td>
</tr>
<tr>
<td align="center" colspan="2"><img src="public/screenshots/mobile-chat.png" alt="Mobile" width="220"><br><em>Same session on a phone</em></td>
</tr>
</table>

## Drive it from outside: MCP, `rfc` CLI and webhooks

Everything the browser can do, an external agent (a bot, a scheduler, another Claude) can do through three doors. Full reference in [server/modules/grokbot-mcp/README.md](server/modules/grokbot-mcp/README.md) and [server/rfc-cli/README.md](server/rfc-cli/README.md).

**1. Grokbot MCP** — a Streamable HTTP MCP server embedded in the app at `POST /api/grokbot-mcp`, authenticated with an API key from Settings > API Tokens (`Authorization: Bearer <key>`). About 200 tools, one per REST route (projects, files, git, worktrees, tasks, reviews, automations, profiles, settings…) plus in-process chat tools (`session_create`, `session_send`, `session_status`, `session_events`, `session_approve_tool`, `session_abort`) and `shell_exec`. Point any MCP client at it:

```json
{ "mcpServers": { "rfc-code": { "type": "http", "url": "http://localhost:7799/api/grokbot-mcp", "headers": { "Authorization": "Bearer ck_…" } } } }
```

Token-saving tools, made for agents that poll:

| Tool | What it returns |
|---|---|
| `session_summary { sessionId, sinceSeq? }` | One small object: status (`running` / `idle` / `waiting_approval` / `error`), start, duration, last seq, pending approval, the agent's final answer (≤1500 chars), `git diff --stat`, detected test run, last commit and branch |
| `project_list { compact: true }` | `{ projectId, name, path, activeSessions, sessionsTotal, lastActivity }` per project, skipping empty worktrees (a few KB instead of ~140 KB) |
| `notification_endpoint_upsert { channel: "session_webhook", … }` | Registers a webhook (below) |
| `notification_deliveries`, `notification_endpoint_test` | Delivery log and a test post |

**2. `rfc` CLI** — the same summaries from a shell on the host, as a thin client of the MCP (no logic of its own). Config: `RFC_URL` / `RFC_API_KEY` or `~/.rfc-code/rfc-cli.json` (`{"url":"http://localhost:7799","apiKey":"ck_…"}`, mode 600). `--json` on every command prints one compact line.

```bash
rfc sessions [--project rfc-code]          # one line per session: id, project, state, last activity
rfc send <sessionId> "run the tests"       # or --file prompt.md; prints "sent <id> seq=<n>"
rfc status <sessionId>                     # ≤10 lines: state, project, branch, start, duration, seq, approval
rfc result <sessionId> [--since <seq>]     # final answer, diff --stat, tests, last commit, branch
rfc notify-test <endpointId>               # posts a session.test event to a webhook
```

Install on the host after a build: copy [install/templates/rfc](install/templates/rfc) to `/usr/local/bin/rfc`, replacing `__RFC_CODE_APP_ROOT__` with the checkout path (`npm run build` must have produced `dist-server/`).

**3. Session webhooks** — when a session goes from running to `idle`, `error` or `waiting_approval`, the server POSTs to every registered endpoint whose filter matches:

```json
// notification_endpoint_upsert
{ "channel": "session_webhook", "endpointId": "james", "url": "https://bot.example/rfc",
  "secret": "…", "events": ["session.idle", "session.error", "session.waiting_approval"],
  "projects": [], "sessions": [] }
```

Payload: `{ event, deliveryId, sentAt, sessionId, project: { id, name, path }, status, startedAt, finishedAt, lastSeq, summary }` where `summary` is the `session_summary` object. Headers: `X-RFC-Event`, `X-RFC-Delivery` and `X-RFC-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`. Three attempts (1 s, 4 s, 16 s back-off, 5 s timeout each); every attempt is logged and readable with `notification_deliveries` — never the payload, never the secret. The secret is also never returned by the API (`hasSecret`, `secretLast4` only) and omitting it on a later upsert keeps the stored one.

## Install

RFC Code runs as a native user service, not a container, so it keeps the host's filesystem, credentials and the agent CLIs you already have. Requires Node.js 22+ and git.

```bash
git clone https://github.com/richardfcampos/rfc-code.git
cd rfc-code
./install/install.sh
```

The installer builds the app, registers a macOS LaunchAgent or a Linux systemd user unit (with `loginctl enable-linger`) so the service starts on boot and restarts on crash, and installs any of the four agent CLIs that are missing. On Linux the unit also runs with `OOMScoreAdjust=-900`, with `claude` and `bash` shims in `~/.rfc-code/bin` handing a killable score back to sessions, terminals and MCP servers — when memory runs out, a runaway child dies instead of the server and every open session with it. It listens on `127.0.0.1:7789`. Config lives in `~/.rfc-code/env`, data (database and profiles) in `~/.rfc-code/data`. `./install/uninstall.sh` removes the service and keeps the data.

| Flag | Effect |
|---|---|
| `--workspaces-root <path>` | Parent directory of the projects shown in the UI (default `$HOME`) |
| `--bind <addr>` / `--port <n>` | Listen address and port. A tailnet IP also needs `AUTH_TRUSTED_NATIVE_BIND=1` in the env file; wildcard binds are refused in trusted mode |
| `--agents <list>` / `--no-agents` | Which agent CLIs to install when missing |
| `--fix-codex-sandbox` | Allow relaxing the kernel user-namespace restriction (see below) |
| `--yes` / `--dry-run` | Skip prompts / print every mutating action instead of running it |

`cursor-agent` has no npm package; the installer prints the vendor's `curl https://cursor.com/install | bash` and runs it only when you confirm, pass `--yes` from a terminal, or name it in `--agents`.

> **Linux + codex:** codex sandboxes everything it runs inside an unprivileged user namespace, which Ubuntu 24.04+ blocks by default (`kernel.apparmor_restrict_unprivileged_userns=1`). The installer probes it and, if it fails, prints the `sysctl` commands. It applies them only with `--fix-codex-sandbox` or your confirmation. This lowers a host-wide kernel restriction, not a codex-specific one.

> **macOS:** starting on boot needs auto-login enabled, and if your projects live on an external volume the first launchd run may need the `node` binary granted Full Disk Access.

## Configure

Every variable is documented in [install/templates/env.example](install/templates/env.example). The ones you are most likely to touch in `~/.rfc-code/env`:

| Variable | Purpose |
|---|---|
| `HOST`, `SERVER_PORT` | Where the service listens |
| `AUTH_MODE=trusted`, `AUTH_TRUSTED_NATIVE_BIND=1` | Skip login on a network you trust (loopback or a declared tailnet bind only) |
| `WORKSPACES_ROOT` | Parent directory of browsable projects |
| `VOICE_API_BASE_URL`, `VOICE_API_KEY`, `VOICE_STT_MODEL`, `VOICE_TTS_MODEL`, `VOICE_TTS_VOICE` | Voice backend; unset hides the mic and read-aloud |
| `NOTIFY_URL`, `NOTIFY_TOKEN` | notify-hub push channel (also settable in Settings > Notifications) |
| `BUNDLED_SKILLS_ROOT`, `AGENT_KIT_ROOT` | Relocate or disable the bundled skills and kit |

Per-agent settings (account, permissions, MCP servers, skills) live in Settings > Agents and are stored per account profile. An Nginx sub-path template is in [docs/nginx-subpath-template.conf](docs/nginx-subpath-template.conf).

Moving from an older Docker deploy: `install/migrate-from-docker.sh --data-root <old data root> --projects-map /projects=<real path>` copies the database and profiles into the native layout and rewrites the container-only paths. The source is never modified.

## Development

```bash
npm install
npm run dev          # Vite client + tsx server with reload
npm run build        # client and server
npm run typecheck
npm run lint
npm test
```

Layout worth knowing:

- `server/` — Express + WebSocket server. Feature modules under `server/modules/` (`tasks`, `reviews`, `collab`, `worktrees`, `automations`, `agent-bridge`, `grokbot-mcp`, `session-summary`, `profiles`, `notifications`, `providers`, …), each with its own routes, services and tests. `server/rfc-cli/` is the host CLI.
- `src/` — React client. One folder per feature under `src/components/` (`task-board`, `review-center`, `collab`, `overview`, `team-view`, `sidebar`, …).
- `skills/`, `agent-kit/` — the bundled agent toolbox, linked into profiles at runtime.
- `install/` — installer, uninstaller, migration script and service templates.
- `docs/designs/` — design notes for larger features.
- `AGENTS.md` — instructions any coding agent gets when working in this repo, including how to use the CodeGraph index.

## License

GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE), including the additional terms under Section 7.

RFC Code is a modified version of **CloudCLI UI (https://github.com/siteboon/claudecodeui)**, originally by Siteboon AI B.V. It is clearly not the original CloudCLI UI, and the names CloudCLI and Siteboon are used here only to state that origin, as the license requires. If you modify RFC Code and run it as a network service, you must make your modified source available to its users.
