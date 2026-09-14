<div align="center">
 <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
 <h1>Cloud CLI (aka Claude Code UI)</h1>
 <p>A desktop and mobile UI for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://developers.openai.com/codex">Codex</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a> and <a href="https://opencode.ai">OpenCode</a>.<br>Use it locally or remotely to view your active projects and sessions from everywhere.</p>
</div>

> **RFC Code** is a modified version based on [CloudCLI UI](https://github.com/siteboon/claudecodeui) (`siteboon/claudecodeui`), licensed under AGPL-3.0. This fork is an independent, self-hosted personal project and is not affiliated with, endorsed by, or published by CloudCLI or Siteboon — their names and marks are used here only to comply with AGPL-3.0 Section 7 attribution requirements, not to claim association.

<p align="center">
 <a href="https://cloudcli.ai">CloudCLI Cloud</a> · <a href="https://cloudcli.ai/docs">Documentation</a> · <a href="https://discord.gg/buxwujPNRE">Discord</a> · <a href="https://github.com/siteboon/claudecodeui/issues">Bug Reports</a> · <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
 <a href="https://cloudcli.ai"><img src="https://img.shields.io/badge/☁️_CloudCLI_Cloud-Try_Now-0066FF?style=for-the-badge" alt="CloudCLI Cloud"></a>
 <a href="https://discord.gg/buxwujPNRE"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join our Discord"></a>
 <br><br>
 <a href="https://trendshift.io/repositories/15586" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15586" alt="siteboon%2Fclaudecodeui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="right"><i><b>English</b> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a></i></div>

---

## Screenshots

<div align="center">

<table>
<tr>
<td align="center">
<h3>Desktop View</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop chat with the project sidebar and tab bar" width="400">
<br>
<em>Chat with a Claude session; tabs for Shell, Files, Source Control, Collab, Board, Reviews, Team, Browser and Tasks</em>
</td>
<td align="center">
<h3>Mobile Experience</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile chat view" width="200">
<br>
<em>Same session on a phone</em>
</td>
</tr>
<tr>
<td align="center">
<h3>Overview</h3>
<img src="public/screenshots/overview.png" alt="Overview dashboard" width="400">
<br>
<em>Running sessions, tasks and per-project boards across every project</em>
</td>
<td align="center">
<h3>Task Board</h3>
<img src="public/screenshots/tasks-board.png" alt="TaskMaster kanban" width="400">
<br>
<em>TaskMaster kanban with the review column and task dependencies</em>
</td>
</tr>
<tr>
<td align="center">
<h3>Collab</h3>
<img src="public/screenshots/collab.png" alt="Collaborations list" width="400">
<br>
<em>Multi-agent debates between account profiles, with round budget and verdict</em>
</td>
<td align="center">
<h3>Source Control &amp; Worktrees</h3>
<img src="public/screenshots/source-control-worktrees.png" alt="Source control tab" width="400">
<br>
<em>Stage, commit, push, branches and worktrees</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>Model Picker</h3>
<img src="public/screenshots/cli-selection.png" alt="Model picker across providers" width="400">
<br>
<em>One picker for Claude, Codex, Cursor and OpenCode models, plus the account profile to run as</em>
</td>
</tr>
</table>

</div>

## Features

- **Responsive Design** - Works seamlessly across desktop, tablet, and mobile so you can also use Agents from mobile 
- **Interactive Chat Interface** - Built-in chat interface for seamless communication with the Agents
- **Integrated Shell Terminal** - Direct access to the Agents CLI through built-in shell functionality
- **File Explorer** - Interactive file tree with syntax highlighting and live editing
- **Git Explorer** - View, stage and commit your changes. You can also switch branches 
- **Browser Use** - Open browser sessions for web research, testing, and agent-driven browser tasks
- **Session Management** - Resume conversations, manage multiple sessions, and track history
- **Plugin System** - Extend CloudCLI with custom plugins — add new tabs, backend services, and integrations. [Build your own →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI Integration** *(Optional)* - Advanced project management with AI-powered task planning, PRD parsing, and workflow automation
- **Model Compatibility** - Works with Claude and GPT model families (the full list of supported models is available at runtime via `GET /api/providers/:provider/models`)

## What RFC Code adds on top of CloudCLI UI

Everything below is fork-specific. The upstream sections further down (CloudCLI Cloud, npm package, desktop app, plugins) describe the original project and still apply where noted.

- **Four agents** - Claude Code, Codex, Cursor CLI and OpenCode share one chat, session list and model picker (`server/modules/providers/`).
- **Account profiles and mid-session handoff** - several accounts per provider, each with its own isolated config directory. A running session can be handed to another account between turns without losing the conversation; when the target speaks a different provider the transcript is summarized into a primer instead.
- **Task board** - TaskMaster kanban with a proper *review* column, task detail drawer (description, attachments, evidence log), decomposition into subtasks with dependencies, and a live refresh whenever `tasks.json` changes on disk. `task-master init` is idempotent and repairs model roles that have no API key to the `claude-code` provider.
- **Review Center and review cockpit** - review queue with per-line diff comments, approve-and-merge, and request-changes that routes feedback back to the agent through TaskMaster. The cockpit's UAT block boots the project's dev server (per-project recipe, auto-detected from `package.json`) and hands back a tailnet-reachable URL with a log tail. Design notes in [docs/designs/review-cockpit-uat-runner.md](docs/designs/review-cockpit-uat-runner.md).
- **Overview dashboard** - `/overview` shows running sessions, a flat task list and a mini kanban per project, colour-coded and filterable, with deep links straight to a task or its review cockpit.
- **Collab and council** - multi-agent rounds (debate, review, vote, council) between Claude and Codex participants, with a per-run token/turn/timeout budget. Council turns carry a structured contract (evidence, risks, tests, disagreements, confidence) that is summarized above the transcript.
- **Team view** - read-only live graph of the running sessions and the handoff messages flowing between them.
- **Agent bridge (MCP)** - an agent inside a session can drive its own project's task board, decompose and delegate work, send and answer handoff messages and pick an account profile, through a stdio MCP server (`server/agent-bridge-mcp.ts` -> `/api/agent-bridge`). A `maestro` skill is bundled for leader sessions and a `task-board` skill for workers.
- **Automations** - cron, board-column change, inbound webhook and plan-usage triggers fire an action: prompt an agent, create a task or send a push. Every firing is idempotent, retried three times and auditable. See [server/modules/automations/README.md](server/modules/automations/README.md).
- **Worktrees** - create and merge git worktrees from the UI. A new worktree gets the project's untracked skills, its gitignored agent config (`CLAUDE.md`, `.cursor/`, `.mcp.json`) symlinked back to the main checkout, a non-colliding branch name and, when the source repository is indexed, its own CodeGraph index.
- **CodeGraph** - projects report whether a `.codegraph/` index exists; the sidebar shows a badge or a click-to-index action, and `AGENTS.md` tells every agent to query it before grepping.
- **Bundled skills and AgentKit kit** - 145 skills ship in [`skills/`](skills/README.md) (106 from the AgentKit Engineer kit, 39 gstack and specialist skills) and the kit's agents, rules, hooks, output styles and status line ship in [`agent-kit/`](agent-kit/README.md). Both are linked into each profile at runtime and toggled per profile in the skills panel. Projects can also widen an agent's working set with extra directories, like the CLI's `--add-dir`.
- **Notifications** - a bell on the project row opts that project into phone pushes through a self-hosted [notify-hub](https://github.com/richardfcampos/notify-hub); URL, token and timezone are set in Settings > Notifications, with a test button.
- **Voice** - mic input and read-aloud through any OpenAI-compatible audio backend (OpenAI, Groq, or a local Speaches / LocalAI / Kokoro server), toggled per user in Settings > Voice.
- **Native install** - runs as a systemd or launchd user service instead of a container, so it keeps the host's filesystem, credentials and already-installed agent CLIs. Trusted (login-free) mode is allowed only on loopback or a declared tailnet bind. An Nginx sub-path template lives in [docs/nginx-subpath-template.conf](docs/nginx-subpath-template.conf).


## Quick Start

### CloudCLI Cloud (Recommended)

The fastest way to get started — no local setup required. Get a fully managed, containerized development environment accessible from the web, mobile app, API, or your favorite IDE.

**[Get started with CloudCLI Cloud](https://cloudcli.ai)**

### Self-Hosted (Open source)

#### npm

Try CloudCLI UI instantly with **npx** (requires **Node.js** v22+):

```
npx @cloudcli-ai/cloudcli
```

Or install **globally** for regular use:

```
npm install -g @cloudcli-ai/cloudcli
cloudcli
```

Open `http://localhost:3001` — all your existing sessions are discovered automatically.

Visit the **[documentation →](https://cloudcli.ai/docs)** for full configuration options, PM2, remote server setup and more.

#### Native Install (this fork)

This fork runs as a native system service instead of a Docker container, so it keeps full access to the host filesystem, credentials, and any agent CLIs already installed:

```bash
./install/install.sh
```

Registers a macOS LaunchAgent or a Linux systemd user unit (`loginctl enable-linger`) so the service starts on login/boot and restarts on crash. It listens on `127.0.0.1:7789` by default. Config lives in `~/.rfc-code/env` (every variable is documented in [install/templates/env.example](install/templates/env.example)), data (DB + profiles) in `~/.rfc-code/data`. To remove it, run `./install/uninstall.sh` (data is kept).

| Flag | Effect |
|---|---|
| `--workspaces-root <path>` | Parent directory of the projects shown in the UI (default `$HOME`) |
| `--bind <addr>` / `--port <n>` | Listen address and port (default `127.0.0.1:7789`). A tailnet IP also needs `AUTH_TRUSTED_NATIVE_BIND=1` in the env file; wildcard binds are refused in trusted mode |
| `--agents <list>` / `--no-agents` | Which agent CLIs to install when missing |
| `--fix-codex-sandbox` | Allow relaxing the kernel user-namespace restriction (see below) |
| `--yes` / `--dry-run` | Skip prompts / print every mutating action instead of running it |

The four agent CLIs the app drives — `claude`, `codex`, `cursor-agent`, `opencode` — are installed when missing, and any you already have is left untouched. Use `--agents=codex,opencode` for a subset or `--no-agents` to install none. `cursor-agent` has no npm package, so it can only come from the vendor's `curl https://cursor.com/install | bash`: the installer prints that command and runs it only when you confirm at the prompt, pass `--yes` from a terminal, or name it in `--agents`; an unattended run skips it and tells you how to install it by hand.

Optional integrations are switched on by uncommenting variables in `~/.rfc-code/env`: `VOICE_API_BASE_URL` and friends for voice, `NOTIFY_URL` / `NOTIFY_TOKEN` for the push channel, `BUNDLED_SKILLS_ROOT` and `AGENT_KIT_ROOT` to relocate or disable the bundled skills and kit.

Coming from the retired Docker deploy? `install/migrate-from-docker.sh --data-root <old data root> --projects-map /projects=<real path>` copies the DB and profiles into the native layout and rewrites the container-only absolute paths. The source is never modified.

> **Linux + codex:** codex sandboxes everything it runs inside an unprivileged user namespace, which Ubuntu 24.04+ blocks by default (`kernel.apparmor_restrict_unprivileged_userns=1`). The installer probes it (`codex sandbox -P :read-only -- true`) and, if it fails, explains the consequence — collaboration participants backed by codex cannot read the repository yet still answer, so the result looks informed but is ungrounded — and prints the `sysctl` commands. It only applies them with `--fix-codex-sandbox` or your confirmation at the prompt, and re-runs the probe afterwards; an unattended run just warns and continues. Note that this lowers a host-wide kernel restriction, not a codex-specific one.

> **macOS:** starting on boot needs auto-login enabled (System Settings → Users), and if your checkout or projects live on an external volume, the first launchd run may need you to grant the `node` binary Full Disk Access (System Settings → Privacy & Security) before it can read them.

#### Docker Sandboxes (Experimental)

Run agents in isolated sandboxes with hypervisor-level isolation. Starts Claude Code by default. Requires the [`sbx` CLI](https://docs.docker.com/ai/sandboxes/get-started/).

```
npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project
```

Supports Claude Code and Codex. See the [sandbox docs](docker/) for setup and advanced options.

### Desktop Companion App

CloudCLI Desktop is an optional native companion for CloudCLI Cloud and Local CloudCLI. It ships from this repository's GitHub Releases and keeps CloudCLI available from your menu bar or tray.

- **[macOS](https://cloudcli.ai/download/macos)**
- **[Windows](https://cloudcli.ai/download/windows)**
- **[Download page](https://cloudcli.ai/download)** · **[GitHub Releases and checksums](https://github.com/siteboon/claudecodeui/releases)**

Use it to open CloudCLI Cloud environments, switch between local and remote workspaces, and copy mobile/browser URLs. To work locally, choose **Local CloudCLI** in the desktop app; it will use your running local server or start one for you.


---

## Which option is right for you?

CloudCLI UI is the open source UI layer that powers CloudCLI Cloud. You can self-host it on your own machine, run it in a Docker sandbox for isolation, or use CloudCLI Cloud for a fully managed environment. The table describes the upstream options; the fork's native install behaves like the npm column but also drives OpenCode and adds the features listed above.

| | Self-Hosted (npm) | Self-Hosted (Docker Sandbox) *(Experimental)* | CloudCLI Cloud |
|---|---|---|---|
| **Best for** | Local agent sessions on your own machine | Isolated agents with web/mobile IDE | Teams who want agents in the cloud |
| **How you access it** | Browser via `[yourip]:port` | Browser via `localhost:port` | Browser, any IDE, REST API, n8n |
| **Setup** | `npx @cloudcli-ai/cloudcli` | `npx @cloudcli-ai/cloudcli@latest sandbox ~/project` | No setup required |
| **Isolation** | Runs on your host | Hypervisor-level sandbox (microVM) | Full cloud isolation |
| **Machine needs to stay on** | Yes | Yes | No |
| **Mobile access** | Any browser on your network | Any browser on your network | Any device |
| **Desktop companion** | Optional. Choose Local CloudCLI | Optional. Choose Local CloudCLI | Optional. Opens cloud environments |
| **Agents supported** | Claude Code, Cursor CLI, Codex | Claude Code, Codex | Claude Code, Cursor CLI, Codex |
| **File explorer and Git** | Yes | Yes | Yes |
| **MCP configuration** | Synced with `~/.claude` | Managed via UI | Managed via UI |
| **REST API** | Yes | Yes | Yes |
| **Team sharing** | No | No | Yes |
| **Platform cost** | Free, open source | Free, open source | Starts at €7/month |

> All options use your own AI subscriptions (Claude, Cursor, etc.) — CloudCLI provides the environment, not the AI.

---

## Security & Tools Configuration

**🔒 Important Notice**: All Claude Code tools are **disabled by default**. This prevents potentially harmful operations from running automatically.

### Enabling Tools

To use Claude Code's full functionality, you'll need to manually enable tools:

1. **Open Settings** - Click the gear icon at the bottom of the sidebar, then **Agents**
2. **Pick the agent** - Claude, Cursor, Codex or OpenCode each have their own **Permissions** tab
3. **Enable Selectively** - Turn on only the tools you need; the choice is saved per account profile

<div align="center">

![Settings modal](public/screenshots/tools-modal.png)
*Settings > Agents: account, permissions, MCP servers and skills per agent*

</div>

**Recommended approach**: Start with basic tools enabled and add more as needed. You can always adjust these settings later.

---

## Plugins

CloudCLI has a plugin system that lets you add custom tabs with their own frontend UI and optional Node.js backend. Install plugins from git repos directly in **Settings > Plugins**, or build your own.

### Available Plugins

| Plugin | Description |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | Shows file counts, lines of code, file-type breakdown, largest files, and recently modified files for your current project |
| **[Web Terminal](https://github.com/cloudcli-ai/cloudcli-plugin-terminal)** | Full xterm.js terminal with multi-tab support |
| **[Claude Watch](https://github.com/satsuki19980613/cloudcli-claude-watch)** | Watches long-running Claude Code sessions for hangs and exposes process controls |
| **[CloudCLI Scheduler](https://github.com/grostim/cloudcli-cron)** | Create workspace-scoped scheduled prompts and execute them through a local CLI such as Codex or Claude Code |
| **[PRISM CloudCLI](https://github.com/jakeefr/cloudcli-plugin-prism)** | Session intelligence for Claude Code inside CloudCLI, including token burn visibility |
| **[Sessions](https://github.com/strykereye2/cloudcli-plugin-session-manager)** | View, manage, and kill active Claude Code sessions |
| **[Token Cost Calculator](https://github.com/NightmareAway/cloudcli-plugin-token-cost-calculator)** | Calculate API costs from model prices and token usage, with preset model pricing support |
| **[Task Queue](https://github.com/TadMSTR/cloudcli-plugin-task-queue)** | Task queue dashboard to view, filter, and launch agent tasks |
| **[GitHub Issues Board](https://github.com/szmidtpiotr/claude-github-issue)** | Kanban board for GitHub Issues with bidirectional TaskMaster sync and /github-task CLI skill auto-install |

### Build Your Own

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — fork this repo to create your own plugin. It includes a working example with frontend rendering, live context updates, and RPC communication to a backend server.

**[Plugin Documentation →](https://cloudcli.ai/docs/plugin-overview)** — full guide to the plugin API, manifest format, security model, and more.

---
## FAQ

<details>
<summary>How is this different from Claude Code Remote Control?</summary>

Claude Code Remote Control lets you send messages to a session already running in your local terminal. Your machine has to stay on, your terminal has to stay open, and sessions time out after roughly 10 minutes without a network connection.

CloudCLI UI and CloudCLI Cloud extend Claude Code rather than sit alongside it — your MCP servers, permissions, settings, and sessions are the exact same ones Claude Code uses natively. Nothing is duplicated or managed separately.

Here's what that means in practice:

- **All your sessions, not just one** — CloudCLI UI auto-discovers every session from your `~/.claude` folder. Remote Control only exposes the single active session to make it available in the Claude mobile app.
- **Your settings are your settings** — MCP servers, tool permissions, and project config you change in CloudCLI UI are written directly to your Claude Code config and take effect immediately, and vice versa.
- **Works with more agents** — Claude Code, Cursor CLI and Codex, not just Claude Code.
- **Full UI, not just a chat window** — file explorer, Git integration, MCP management, and a shell terminal are all built in.
- **CloudCLI Cloud runs in the cloud** — close your laptop, the agent keeps running. No terminal to babysit, no machine to keep awake.

</details>

<details>
<summary>Do I need to pay for an AI subscription separately?</summary>

Yes. CloudCLI provides the environment, not the AI. You bring your own Claude, Cursor, or Codex subscription. CloudCLI Cloud starts at €7/month for the hosted environment on top of that.

</details>

<details>
<summary>Can I use CloudCLI UI on my phone?</summary>

Yes. For self-hosted, run the server on your machine and open `[yourip]:port` in any browser on your network. For CloudCLI Cloud, open it from any device — no VPN, no port forwarding, no setup. A native app is also in the works.

</details>

<details>
<summary>Will changes I make in the UI affect my local Claude Code setup?</summary>

Yes, for self-hosted. CloudCLI UI reads from and writes to the same `~/.claude` config that Claude Code uses natively. MCP servers you add via the UI show up in Claude Code immediately and vice versa.

</details>

---

## Community & Support

- **[Documentation](https://cloudcli.ai/docs)** — installation, configuration, features, and troubleshooting
- **[Discord](https://discord.gg/buxwujPNRE)** — get help and connect with other users
- **[GitHub Issues](https://github.com/siteboon/claudecodeui/issues)** — bug reports and feature requests
- **[Contributing Guide](CONTRIBUTING.md)** — how to contribute to the project

## License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) — see [LICENSE](LICENSE) for the full text, including additional terms under Section 7.

This project is open source and free to use, modify, and distribute under the AGPL-3.0-or-later license. If you modify this software and run it as a network service, you must make your modified source code available to users of that service.

CloudCLI UI - (https://cloudcli.ai).

## Acknowledgments

### Built With
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor's official CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[OpenCode](https://opencode.ai)** - open source coding agent
- **[React](https://react.dev/)** - User interface library
- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - Advanced code editor
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(Optional)* - AI-powered project management and task planning
- **[AgentKit](https://agentkit.best)** - Engineer kit bundled as skills, agents, rules and hooks
- **[CodeGraph](https://www.npmjs.com/package/@colbymchenry/codegraph)** - code knowledge graph the agents query before grepping


### Sponsors
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
 <strong>Made with care for the Claude Code, Codex, Cursor and OpenCode community.</strong>
</div>
