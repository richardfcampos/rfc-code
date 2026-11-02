# Research — WebSocket chat protocol + headless send (for grokbot MCP)

Source: investigator subagent, 2026-11-02. Paths relative to repo root.

## Key finding
Three modules already start/continue chat turns with NO browser, via a fake
`RealtimeClientConnection` + `chatRunRegistry`:
- `server/modules/reviews/services/session-message-sender.service.ts:43-135` (continue existing session, fan-out to connected clients)
- `server/modules/automations/services/automation-agent-spawn.service.ts:80-170` (create new session + run, headless sink)
- `server/modules/collab` (`configureCollabClaudeRuntime`, `server/index.js:1525`)

## Inbound `/ws` (client→server) — `chat-websocket.service.ts`
- `chat.send` `{ sessionId, content, options? }` — options: `model, effort, permissionMode, toolsSettings{allowedTools[],disallowedTools[],skipPermissions}, skipPermissions, sessionSummary, images, profileId, cwd, projectPath`. Server reads provider/project_path/worktree_path/provider_session_id/profile_id/caveman_mode from the sessions row. Errors (`protocol_error`): SESSION_ID_REQUIRED, SESSION_NOT_FOUND, UNSUPPORTED_PROVIDER, WORKTREE_MISSING, RUN_IN_PROGRESS, org-policy codes.
- `chat.abort` `{ sessionId }` — NO_ACTIVE_RUN.
- `chat.subscribe` `{ sessions: [{ sessionId, lastSeq? }] }` → `chat_subscribed { isProcessing, lastSeq, pendingPermissions[] }` + replay.
- `chat.permission-response` `{ requestId, allow, updatedInput?, message?, rememberEntry? }`.
- `chat.ping`.

## Outbound kinds
Gateway: `chat_subscribed`, `protocol_error`, `chat_pong`, `session_upserted`, `loading_progress`.
Provider (`server/shared/types.ts:169-185`): `text, tool_use, tool_result, thinking, stream_delta, stream_end, error, complete, status, permission_request, permission_cancelled, session_created (swallowed), interactive_prompt, task_notification, provider_switch`. Every live event gets `seq`; `complete` = `{kind, sessionId, actualSessionId, exitCode, success, aborted}` exactly once per run.
Broadcasts: `task_update`, `review_update`, `profile_usage`, `agent_message_update`; legacy `type`-based: `session.handoff`, `taskmaster-*`.

## In-process recipe (what the MCP chat tools will do)
1. Existing session: `sessionsDb.getSessionById(appId)`; new: `sessionsService.createAppSession(provider, projectPath, profileId?)`.
2. `run = chatRunRegistry.startRun({ appSessionId, provider, providerSessionId, connection, userId: null })` — `null` ⇒ RUN_IN_PROGRESS.
3. `spawnFn(command, options, run.writer)` with options `{ sessionId: row.provider_session_id, resume, cwd: worktree_path ?? project_path, projectPath, profileId, cavemanMode, model?, effort?, permissionMode?, toolsSettings? }`.
4. `.finally(() => chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 }))`.
- Abort: `run = chatRunRegistry.getRun(id)`; `abortFns[run.provider](run.providerSessionId)`; `chatRunRegistry.completeRun(id, { exitCode, aborted: true })`.
- Approvals: `resolveToolApproval(requestId, { allow, updatedInput?, message? })` (claude-sdk.js:142), `getPendingApprovalsForSession(providerSessionId)` (claude-sdk.js:967) — keyed by PROVIDER id; remap via `chatRunRegistry.getRun(appId)?.providerSessionId`.
- Live state: `sessionsService.listRunningSessions()`, `chatRunRegistry.getRun(id)`, `chatRunRegistry.replayEvents(id, afterSeq)` (buffer 5000 events, completed runs retained 5 min).
- Connection: `{ readyState: 1, send(str) }` works (reviews uses fan-out to `connectedClients`; automations uses `{readyState: 3, send(){}}`). Never hand a raw fake to `queryClaudeSDK` — go through `startRun().writer`.
- Wiring seam: `server/index.js:1525-1572` `configureXRuntime(...)` injection pattern (lint-enforced module boundary).

## REST history
`GET /api/providers/sessions/:id/messages?limit&offset` → `{success, data:{ messages: NormalizedMessage[], total, hasMore, offset, limit, tokenUsage? }}` (`offset=0` = most recent page).

## Shell `/shell`
`type`-based: in `init {projectPath, sessionId, provider, initialCommand, isPlainShell, cols, rows, profileId}`, `input {data}`, `resize`; out `output {data}`, `error`, `auth_url`. PTY-only, no in-process function. ⇒ MCP exposes a one-shot `shell_exec` instead of a PTY.
