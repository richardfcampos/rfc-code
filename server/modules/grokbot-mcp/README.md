# Grokbot MCP

Lets an external MCP client (Grokbot, or any Streamable HTTP MCP client) read
and change everything the RFC Code web UI can, without a browser.

```
MCP client ──POST /api/grokbot-mcp (Authorization: Bearer <api key>)──▶ routes ─▶ JSON-RPC ─▶ tool registry
                                                                                       ├─▶ rest-dispatcher: loopback HTTP to this server, JWT of the key's owner
                                                                                       ├─▶ chat-gateway: chatRunRegistry + provider runtimes (same path as chat.send)
                                                                                       └─▶ shell-exec: one-shot `bash -lc` in a project directory
```

## Connecting

- URL: `http://<host>:<port>/api/grokbot-mcp` — the port the app itself serves on.
- Header: `Authorization: Bearer <api key>` (or `x-api-key: <api key>`). Keys are
  created in **Settings > API Tokens** and live only in the database. A key is
  required in every auth mode, including `AUTH_MODE=trusted`. In trusted and
  platform modes the REST layer maps every caller to the installation's single
  user anyway, so there the key is a deliberate opt-in step (and a revocable
  one), not a separate identity.
- Transport: MCP Streamable HTTP, stateless, plain JSON responses (no SSE, no
  `Mcp-Session-Id`). `GET` answers 405, `DELETE` answers 204. Protocol version
  `2025-03-26`. JSON-RPC batches are accepted.
- Handshake: `initialize` → `notifications/initialized` → `tools/list` → `tools/call`.

```sh
curl -s http://127.0.0.1:3001/api/grokbot-mcp \
  -H 'Authorization: Bearer <api key>' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"project_list","arguments":{}}}'
```

## How tools work

- **REST tools** (the vast majority) map 1:1 onto the route the UI calls, as a
  loopback request to the server's own bound address with a JWT minted for the
  owner of the API key. Validation, org policies, websocket broadcasts and
  error codes are therefore exactly the UI's. A failing route comes back as a
  `tools/call` result with `isError: true` and text `"<status> <code>: <message>"`.
- **Chat tools** (`session_send`, `session_abort`, `session_status`,
  `session_events`, `session_pending_approvals`, `session_approve_tool`) run
  in-process through `chatRunRegistry` and the provider runtimes, the way the
  Review Center and automations already start turns with no socket behind them.
  `session_send` with `wait: true` blocks until the turn completes (default
  120 s, max 600 s) and returns the assistant text; without it, poll
  `session_status` / `session_events`.
- **Browser-only state** (theme, language, permission allow-lists, default
  model/effort, drafts, voice config) has no server representation and
  therefore no tool. Pass `model`, `effort`, `permissionMode` and
  `toolsSettings` explicitly on `session_send` instead.
- **Streams and binaries**: SSE routes become one-shot tools
  (`project_clone`, `session_search`); uploads take base64
  (`file_upload`, `task_attachment_add`, `asset_upload_*`); downloads return
  base64 capped at 20 MiB (`file_read_bytes`, `task_attachment_download`,
  `asset_download`).
- **`rfc_api_call {method, path, query?, body?}`** reaches any `/api/*` route
  that has no dedicated tool yet.
- **`shell_exec`** runs one command in a project (or worktree) directory with a
  timeout (default 60 s, max 600 s) and a 1 MiB output cap. No PTY.

## Summaries and webhooks (for agents that poll)

An external agent following a session through `session_events` pays for one
frame per streamed token. These additions give it the result in a few hundred
bytes and a push when the session stops.

- **`session_summary { sessionId, sinceSeq? }`** (in-process, module
  `server/modules/session-summary/`): `status` is `running` while a run is in
  progress, `waiting_approval` when a tool permission is pending, `error` when
  the last run ended with a non-zero exit (the text is in `error`), else
  `idle`. `response` is the assistant text of the last turn (events after
  `sinceSeq` while the run buffer is alive, the persisted transcript
  afterwards), truncated to 1500 chars. `git` runs in the session's worktree or
  project: branch, `diff --stat HEAD` summary and file list (40 max),
  untracked count, last commit. `tests` is parsed from tool output (node:test,
  vitest/jest, pytest, phpunit) and `null` when nothing recognisable ran.
- **`project_list { compact: true }`**: `{ projectId, name, path,
  activeSessions, sessionsTotal, lastActivity }` per project, omitting
  `*-worktrees/` entries with no sessions. Without the flag the response is
  unchanged.
- **Session webhooks**: `notification_endpoint_upsert { channel:
  "session_webhook", endpointId, url, secret, events?, projects?, sessions? }`.
  `events` defaults to all three (`session.idle`, `session.error`,
  `session.waiting_approval`); `projects` (ids or paths) and `sessions` (ids)
  empty = everything. The secret is stored once, never returned (reads show
  `hasSecret` and `secretLast4`) and kept when omitted on a later upsert. On a
  transition the server POSTs `{ event, deliveryId, sentAt, sessionId, project,
  status, startedAt, finishedAt, lastSeq, summary }` with `X-RFC-Event`,
  `X-RFC-Delivery` and `X-RFC-Signature: sha256=<hex HMAC-SHA256(secret, raw
  body)>`, three attempts with 1 s / 4 s / 16 s back-off and a 5 s timeout
  each. `notification_deliveries { endpointId?, sessionId?, limit? }` lists one
  row per attempt (never the payload); `notification_endpoint_test {
  endpointId }` posts a `session.test` event through the same path. The
  transition source is `sessionLifecycleEvents` in the websocket module,
  emitted by the run registry when the terminal `complete` or a
  `permission_request` passes; the dispatcher is wired in `server/index.js`
  so no module imports another's internals.
- **Scope and trust of the webhooks**: the install is single-user (trusted
  mode maps every caller to one account), so a transition is offered to every
  enabled `session_webhook` endpoint, whichever user row created it. The
  receiver is chosen by the key holder, so any http(s) host is accepted —
  including loopback and tailnet addresses, which is where a local bot lives —
  and the URL is returned as stored; keep tokens out of the URL and in the
  secret. Secrets must be at least 16 characters; shorter ones are refused and
  a stored secret under 12 characters gets no `secretLast4` hint. The payload
  carries the agent's final answer and the pending approval line (tool name
  plus command, capped at 300 chars): do not point it at a receiver you would
  not show the transcript to. Redirects are not followed.
- **`rfc` CLI** (`server/rfc-cli/`, wrapper in `install/templates/rfc`): a
  thin JSON-RPC client of this endpoint for use on the host —
  `rfc sessions`, `rfc send`, `rfc status`, `rfc result`, `rfc notify-test`,
  all with `--json`. See `server/rfc-cli/README.md`.

## Coverage

`tests/route-coverage.test.ts` scans every route file the server mounts and
fails when a route has neither a tool declaring it in `covers` nor an entry in
the exclusion list (with a reason). Excluded on purpose: login/register,
inbound automation webhooks, the agent bridge and browser-use bridge (own
tokens), plugin static assets, Web Push subscription (needs a service worker),
the voice proxy and the external `/api/agent` surface.

## Smoke test

`node scripts/smoke/grokbot-mcp-smoke.mjs` boots a real server on a free port
with every data directory under `~/.cache/grokbot-smoke/`, creates an API key
over REST and drives the endpoint end to end (handshake, listing, projects,
files, git, worktrees, tasks, automations, sessions, shell, escape hatch).
It is not part of `npm test`. `node scripts/smoke/session-summary-webhooks-smoke.mjs` does the same for `session_summary`, the compact project list, session webhooks (a local receiver that fails once, so the retry and the HMAC are real) and the `rfc` CLI.

## Security

The key grants the same scope as a logged-in user of the UI, plus `shell_exec`
and `rfc_api_call`. Treat it like a password: revoke it in Settings > API
Tokens when in doubt. Loopback calls only ever target the address this process
is bound to, never a URL from the environment.

## Layout

| File | Role |
| --- | --- |
| `grokbot-mcp.routes.ts`, `grokbot-mcp.auth.ts` | HTTP transport and API-key auth |
| `grokbot-mcp.jsonrpc.ts` | MCP methods (`initialize`, `ping`, `tools/list`, `tools/call`) |
| `rest-dispatcher.ts` | loopback REST client with envelope/error normalisation, multipart, bytes, SSE |
| `chat-gateway.ts` | headless chat turns, abort, events, approvals |
| `shell-exec.ts` | one-shot shell runner |
| `tools/*.tools.ts` | one declarative tool table per section (`session-summary.tools.ts`, `session-webhooks.tools.ts` are the agent-facing summary and webhook tools) |
| `grokbot-mcp.module.ts` | composition root (`grokbotMcpRoutes`, `configureGrokbotMcpRuntime`) |
