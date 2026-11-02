# Research — UI sections → backend calls (what the browser does, so MCP can replace it)

Source: investigator subagent, 2026-11-02. Full detail in the subagent transcript; this is the decision-relevant condensation.

## Sections of the app (src/components) and their backend surface
| Section | Backend |
| --- | --- |
| Auth / onboarding | /api/auth/*, /api/user/git-config, /api/user/onboarding-status, /api/user/complete-onboarding, /api/providers/:p/auth/status |
| Sidebar (projects + sessions) | GET /api/projects, /api/projects/:id/sessions, /archived, toggle-star, toggle-notify, rename, DELETE (archive/force), restore; sessions rename/archive/delete/restore; running sessions poll; conversations search (SSE); codegraph status/init |
| Chat | WS chat.send/abort/subscribe/permission-response; GET session messages; token-usage; assets upload; commands list/execute; provider skills; models; active-model; profile handoff; worktree create-on-new-session |
| Files / editor | files tree, file read/save, files/content (bytes), create/rename/delete/upload |
| Shell | WS /shell PTY only |
| Git panel | /api/git/* (status, diff, commits, branches, remote, stage/unstage/commit/discard/fetch/pull/push/publish/checkout/create-branch/delete-branch/revert, compare*) + /api/worktrees/* |
| Task board (native) | /api/tasks/* incl. attachments, evidence, subtasks; WS task_update |
| Review Center | /api/reviews/* (queue, detail, diff, comments, approve, request-changes) |
| Team View | /api/team-view, /api/profiles |
| Collab | /api/collaborations/* |
| TaskMaster tab + PRD + UAT preview | /api/taskmaster/*, /api/preview/*, /api/projects/:id/taskmaster, /api/mcp-utils/taskmaster-server |
| Browser tab | /api/browser-use/* |
| Plugins tabs | /api/plugins/* (+ rpc proxy) |
| Overview (/overview) | running sessions + projects + taskmaster tasks (client-side filters, URL only) |
| Settings > agents | provider auth status, MCP servers CRUD (per provider/scope), skills list/create; permissions lists = localStorage only |
| Settings > profiles | /api/profiles/* (create, delete, default, tooling, usage, skills enable set) |
| Settings > orgs | /api/orgs/* |
| Settings > appearance | localStorage only (theme, language, sort, editor prefs) |
| Settings > git | /api/user/git-config |
| Settings > api | /api/settings/api-keys, /api/settings/credentials |
| Settings > voice | localStorage only (voiceConfig) + /api/voice proxy |
| Settings > tasks | GET /api/taskmaster/installation-status; `tasks-enabled` localStorage |
| Settings > browser | /api/browser-use/settings, /status, /runtime/install |
| Settings > plugins | /api/plugins |
| Settings > notifications | /api/settings/notification-preferences, push subscribe/unsubscribe, /api/notifications/notify-hub (+test), /api/notifications/endpoints |
| Settings > about | /health |
| Quick settings / command palette | localStorage + the calls above (create task, git fetch/pull/push/checkout, navigate) |
| Project creation wizard | /api/browse-filesystem, /api/create-folder, /api/settings/credentials?type=github_token, POST /api/projects/create-project, SSE clone-progress |
| Version upgrade | POST /api/system/update |

## Browser-only state (NOT reachable by any server API — out of MCP scope by nature)
`theme`, `userLanguage`, `claude-settings` (allowedTools/disallowedTools/skipPermissions/projectSortOrder), `cursor-tools-settings`, `codex-settings`, `opencode-settings`, `<provider>-model`, `<provider>-effort`, `permissionMode-*`, `selected-provider`, drafts `draft_input_*`, `queued_message_*`, `worktree-on-new-session-*`, `voiceConfig`, `uiPreferences`, editor prefs, `file-tree-view-mode`, `taskmaster.hideClosedAfterDays`, `tasks-enabled`, `activeTab`, `notificationSoundEnabled`.
⇒ A bot replacing the browser must pass `model`, `effort`, `permissionMode`, `toolsSettings` explicitly on every chat send.

## Non-JSON surfaces needing special tool shapes
- SSE: `GET /api/projects/clone-progress`, `GET /api/providers/search/sessions` → one-shot tools that consume the stream to completion.
- Multipart: `POST /api/assets/images|files`, `POST /api/tasks/:id/attachments`, `POST /api/projects/:id/files/upload` → tools take base64 content.
- Bytes: `GET /api/projects/:id/files/content`, `GET /api/tasks/:id/attachments/:a/download`, `GET /api/assets/*` → tools return base64 with a size cap.
- PTY: `/shell` → one-shot `shell_exec` (no interactive PTY).
