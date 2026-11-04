# rfc CLI + session webhooks — Design

## Modules (boundaries: cross-module imports only through barrels; no cycles)

```
server/modules/session-summary/      NEW module. deps: database, websocket (chatRunRegistry), providers (sessionsService), shared/git-command
server/modules/grokbot-mcp/tools/    session-summary.tools.ts, session-webhooks.tools.ts; projects.tools.ts gains `compact`
server/modules/projects/             getProjectsCompact() + `compact=1` on GET /api/projects
server/modules/websocket/            session-lifecycle.events.ts (EventEmitter) — registry emits on complete / permission_request
server/modules/notifications/        session-webhook-{endpoints,signature,dispatcher}.service.ts; routes mask secret
server/modules/database/             session-webhook-deliveries.db.ts + table in schema/migrations
server/rfc-cli/                      rfc-cli.ts (entry), rfc-cli-args.ts, rfc-cli-client.ts, rfc-cli-config.ts, rfc-cli-render.ts
server/index.js                      wiring: lifecycle → dispatcher (with buildSessionSummary injected) — avoids notifications→session-summary→websocket→notifications cycle
```

## Data flow

1. Runtime emits `complete` → `decorateAndRecordEvent` (registry) → `sessionLifecycleEvents.emit('transition', {sessionId, provider, status, startedAt, finishedAt, lastSeq, exitCode, aborted, requestId?})`.
2. index.js subscribes `dispatchSessionWebhooks(transition)` → loads enabled `session_webhook` endpoints for the session owner (single user in trusted mode: all users' endpoints matched by filter), builds summary via injected `buildSessionSummary`, signs, posts with retry, logs each attempt.
3. CLI → `POST /api/grokbot-mcp` JSON-RPC `tools/call` → tools.

## Storage

- Endpoints: existing `notification_channel_endpoints` with `channel = 'session_webhook'`; `metadata_json = { url, secret, events[], projects[], sessions[] }`. Secret masked by `sanitizeEndpoint`.
- Deliveries: new table `session_webhook_deliveries(id INTEGER PK, delivery_id TEXT, endpoint_id TEXT, user_id INTEGER, event TEXT, session_id TEXT, attempt INTEGER, ok INTEGER, http_status INTEGER NULL, error TEXT NULL, created_at TEXT)`; keep last 500 per endpoint.

## Signature

`X-RFC-Signature: sha256=` + hex(HMAC-SHA256(secret, rawBody)). Receiver recomputes over the exact bytes received.

## Decisions

- D1 waiting_approval fires immediately (no 60 s grace like notify-hub) — the external agent wants to act.
- D2 Secret stored plain in metadata_json (same posture as notify-hub token in app_config); never returned, never logged.
- D3 CLI is a thin JSON-RPC client; zero business logic duplicated.
- D4 Tests heuristic: parse tool_result text for node:test (`# pass N` / `# fail N`), vitest/jest (`Tests: N passed, M failed, T total`), pytest (`N passed, M failed`), phpunit (`OK (N tests` / `Tests: N, ... Failures: M`).
