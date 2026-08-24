# Scout Report — Agent runs dying on long tasks

---
date: 2026-08-22 09:59 UTC
type: scout
scope: rfc-code — "agent cai direto em tasks longas, há tempos"
agents: 3 parallel Explore (run lifecycle, transport/infra, client) + live prod evidence (journal + sqlite)
---

## Summary

Two distinct bug families, both real:

1. **Perceived death (most frequent):** run keeps executing server-side, but the UI silently drops the "running" indicator or sits on a dead socket. User sees agent "cair"; server-side run is alive.
2. **Real death (near-daily):** Claude Agent SDK throws `[ede_diagnostic]` error after an abort→restart sequence; plus auth expiry, session limits, server restarts, and any unhandled rejection (no handler installed — kills whole server).

Live evidence: 17 `ede_diagnostic` errors in journal since Aug 16 (retention limit); 7 rows in `session_run_failures` (5× "Not logged in", 1× session limit, 1× "The run stopped without reporting a reason"); abort-loop flood 19×/1s on Aug 21 22:33; 383 ws connect/disconnects in 7 days against a single stable server process (NRestarts=0, no OOM since 8G swap fix).

## Relevant Files

### Server — run lifecycle
- `server/claude-sdk.js` — SDK runner. `query()` at :701-704; consumption loop :730-770; error path :792-823 (sends `error` + `complete` exitCode 1); abort via `interrupt()` :900-931 (log line "Error aborting session" = :926); **`CLAUDE_CODE_STREAM_CLOSE_TIMEOUT='300000'` set at :696-697, restored at :716-721 across an `await` (:702) — env-var race between concurrent run starts**; tool-approval timeout 15 min (:53, denies tool on expiry :672-674)
- `server/modules/websocket/services/chat-websocket.service.ts` — dispatch `spawnFn` :325; **safety-net `completeRunIfCurrent({exitCode: 1})` :335 → source of "stopped without reporting a reason"**; `chat.abort` :372-399; **orphan hazard :391-397 (null `providerSessionId` → abort skipped, run marked complete, runtime keeps executing)**; `ws.on('close')` :550-553 only deletes client — disconnect never aborts a run (by design)
- `server/modules/websocket/services/chat-run-registry.service.ts` — in-memory run map :67 (lost on restart, no boot-time reconciliation for chat runs); event buffer cap 5000 :58 (truncation invisible to client); completed-run retention 5 min :50; failure persistence trigger :200-208; `persistFailureIfAny` :120-152 (aborted → skip; exit 0 → clear; else record `lastErrorText` or generic fallback :144)
- `server/modules/websocket/services/chat-session-writer.service.ts` — :140-144 silently discards frames when socket not OPEN
- `server/modules/database/repositories/session-run-failures.db.ts` — persistence (cap 50/session, 2000-char msg)
- `server/modules/providers/services/sessions.service.ts` — merges failures into history :98-111; `listRunningSessions` (feeds the client 5s poll)
- `server/index.js` — spawn/abort dispatch :119-140; **shutdown :1708-1727 never drains runs, no failure row written**; **no `uncaughtException`/`unhandledRejection` handler anywhere in server/** — any async throw kills process + all runs; collab-only orphan cleanup :1629 (no chat equivalent)

### Server — transport/infra
- `server/modules/websocket/services/websocket-server.service.ts` — 30s `ws.ping()` :39-51, **no pong tracking, no `terminate()` → half-open sockets never detected**; heartbeat comment assumes proxies that don't exist in this deployment (direct Tailscale bind, `HOST=100.99.234.46:7799`, no nginx/caddy)
- `install/templates/rfc-code.service` — `Restart=on-failure`, default `KillMode=control-group` → **restart/deploy SIGTERMs every agent child**
- No HTTP server timeouts configured (Node defaults); no memory guards; prod = plain `node`, no watcher

### Client
- `src/hooks/useSessionProtection.ts` — **the run state machine**: map presence = running, no failed/dead state; `LOCAL_ACTIVITY_GRACE_MS = 10_000` :37 measured from run **start** :156-160 → **any run >10s vanishes silently the first time one `/sessions/running` poll omits it**
- `src/components/app/AppContent.tsx` — :102-143 5s poll → `syncProcessingSessions` (map replaced wholesale)
- `src/contexts/WebSocketContext.tsx` — reconnect fixed 3s, onclose-only :137-146; no client ping; no `visibilitychange`/`online` trigger; `isConnected` exported :41,179 but consumed by nothing → **no offline indicator, spinner keeps ticking on dead socket**; no outbound queue (:157-164 silently drops sends); duplicate-socket hazard :102-104/:120
- `src/components/chat/view/ChatInterface.tsx` — reconnect resubscribe :330-341 (only visible session; early-return if none selected); `lastSeq` in ref :59, reset on reload
- `src/stores/useSessionStore.ts` — persisted failures render only after history refetch; no refetch triggered if `complete` never reached client → silent death shows nothing in transcript
- `useChatRealtimeHandlers.ts` — terminal `complete` :242-287; live `error` frame explicitly non-terminal :289-291

## Findings — ranked by likely contribution

| # | Cause | Kind | Evidence |
|---|-------|------|----------|
| 1 | UI drops running-state after 10s grace when one poll omits the run (`useSessionProtection.ts:37,156-160`) | perceived | Exact "vanishes silently" surface; grace measured from start, not last activity |
| 2 | Half-open sockets undetected both sides; output black-holed; no offline UI | perceived | 383 connect/disconnect in 7d; Tailscale DERP path flips break TCP silently |
| 3 | `ede_diagnostic` SDK error after abort→restart same second (`claude-sdk.js:926`; SDK `readMessages`) | real | 17× since Aug 16, incl. 19× flood Aug 21 22:33; persisted as "stopped without reporting a reason" |
| 4 | SDK 74 patches stale: 0.3.165 vs 0.3.239; `STREAM_CLOSE_TIMEOUT` env race (`claude-sdk.js:696-721`) | real | Upstream reports `ede_diagnostic` = internal abort diagnostic wrongly surfaced as error |
| 5 | No `unhandledRejection` handler → whole server dies, all runs lost, zero failure rows | real | Systemd restarts in 5s masking it; currently NRestarts=0 though |
| 6 | Deploy/restart kills all children (`KillMode=control-group`), shutdown never drains runs (`index.js:1708-1727`) | real | Restarts Aug 18 + Aug 20 in journal; `.specs/STATE.md:48-49` documents prior OOM-kill era losing background agents |
| 7 | Auth expiry mid-stack ("Not logged in" ×5) + session limit ×1 | real | `session_run_failures` rows Aug 16-22 |
| 8 | 15-min tool-approval timeout denies tool → long unattended runs stall out (`claude-sdk.js:53,672-674`) | real | Design, unconfirmed in logs |
| 9 | Abort with null `providerSessionId` orphans live runtime (`chat-websocket.service.ts:391-397`) | both | Code-confirmed hazard |
| 10 | Replay gaps: 5000-event buffer trim invisible, completed runs not replayed, 5-min retention, `lastSeq` reset on reload | perceived | Code-confirmed |

## Recommendations (for /ck:debug → /ck:fix ordering)

1. Fix #1 first — cheapest, biggest perceived-reliability win (grace from *last activity*, or union poll with local state + explicit terminal signal).
2. Add pong tracking + `ws.terminate()` server-side; client ping or `visibilitychange` reconnect; surface `isConnected`.
3. Upgrade `@anthropic-ai/claude-agent-sdk` → 0.3.239; then re-test `ede_diagnostic`; fix env-var race regardless.
4. Add `process.on('unhandledRejection')` logging (at minimum) + graceful shutdown that drains/records running runs as failure rows.

## Fix Applied (2026-08-22, /fix pass — verified by code + tests)

Diagnosis refinement: `listRunningSessions` is backed by the in-memory
`chatRunRegistry` (`sessions.service.ts:191`), so it can NEVER transiently omit
a live run while the server is up — finding #1's real shape is: the prune is
always *correct* (run truly ended or server restarted), but the client had no
refetch/feedback on that path, so the persisted failure row or final answer
never appeared. Grace logic in `useSessionProtection` left unchanged on purpose.

Shipped:
1. Falling-edge transcript refresh when a run ends without a live `complete`
   frame — `src/components/chat/utils/run-end-transcript-refresh.ts` (pure
   guard + 7 tests), wired through `useChatSessionState` /
   `useChatRealtimeHandlers` / `ChatInterface` via `completeReceivedAtRef`.
2. `server/index.js`: shutdown records a `session_run_failures` row per
   in-flight run (reentrancy-guarded, per-run try/catch); process-level
   `unhandledRejection` handler logs instead of crashing the whole server.
3. `npm test` glob now includes `src/**/*.test.ts` (25 client tests were
   orphaned). 635/635 pass; tsc clean both configs; lint clean; build OK.
Code-review pass: DONE_WITH_CONCERNS, all Low findings addressed. Residual by
design: SIGKILL/OOM hard-death still writes no failure row (needs boot-time
persisted-run sweep — follow-up candidate).

## Unresolved Questions

- What fires "Aborting SDK session" immediately before each `ede_diagnostic` (user stop vs send-while-running flow)? Log shows abort + restart same second, same session — code path not pinned.
- Aug 21 22:33 flood: 19 abort attempts in 1s — retry loop location not identified.
- Journal retention starts ~Aug 16 — pre-Aug-16 history ("há tempos") unverifiable from logs; `.specs/STATE.md` OOM era is the documented earlier chapter.
- Still open (separate passes): SDK upgrade 0.3.165 → 0.3.239 (`ede_diagnostic`), ws pong tracking + client reconnect triggers, `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` env race.
