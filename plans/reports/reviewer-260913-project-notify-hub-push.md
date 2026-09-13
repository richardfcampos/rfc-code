# Review — per-project notify-hub push (branch `rfc-code`, uncommitted tree)

Date: 2026-09-13
Scope: working-tree diff, 56 modified + 13 untracked files (~925 insertions).
Verification run: `npm run typecheck` → 0 errors. `npm test` → 704 pass / 0 fail. `npx eslint src/ server/` → 0 errors, 241 warnings (all pre-existing rule classes; the 7 new files are clean). Feature-scoped subset (`server/modules/notifications/**`, `project-notify.service.test.ts`) → 33 pass / 0 fail.

---

## Critical

None.

Specifically cleared:
- Token never reaches the client in full: `toNotifyHubPublicView` (notify-hub-config.service.ts:145) emits only `hasToken` + last-4 hint; the Settings form seeds `token: ''` on every load/save (useNotifyHubSettings.ts:48-53). No token in logs (`logChannelError` prints `error.message` only), no token in error responses.
- PUT with empty/omitted token preserves the stored one (notify-hub-config.service.ts:130-132) — verified by test.
- `isEnabled()` is synchronous and cannot throw: `readConfig()` wraps the sqlite read (webhook-notify-channel.service.js:46-53); `dispatchIfAllowed` wraps project lookup, payload build and dispatch, and the fetch promise is `.catch`-ed; the deferred timer body calls the same wrapped function and is `unref`-ed.
- Gate is fail-closed: unknown path, missing project row, DB error → `null` → no send. Provider-vs-app session id both tried.
- Migration column lists line up in all four paths (fresh `PROJECTS_TABLE_SCHEMA_SQL`, `addColumnToTableIfNotExists` on the PK-schema branch, the CTE rebuild, and the legacy `workspace_original_paths` INSERT). Ordering in `runMigrations` (migrations.ts:770-772) guarantees `notifyEnabled` exists before the legacy INSERT references it. No duplicate-column risk.
- web-push/desktop payload text unchanged: `buildNotificationPayload` reads named meta fields only, never spreads `meta`, so the new `projectPath`/`startedAt` do not reach browser push (no path leak either).
- Star toggle untouched; `/api/projects` and `/api/notifications` both mounted behind `authenticateToken` (server/index.js:195, 221).

---

## Major

### 1. `src/hooks/useProjectsState.ts:324` and `:731-742` — `notifyEnabled` is dropped when a `Project` is rebuilt field-by-field

`projectFromRegistration` and the `session_upserted` "project this client has never seen" branch construct a `Project` from an explicit field list (`projectId/path/fullPath/displayName/isStarred/...`). `notifyEnabled` is not in the list, and `SessionUpsertedEvent.project` (line 36-41) has no such field, so the resulting project carries `notifyEnabled: undefined`.

Failure scenario: project P has the bell ON in the DB. A new session for P arrives over the websocket before the client has P in its list (fresh tab, new worktree-project, session started from another device). Sidebar renders the bell OFF (`readFlag` → `false`). The user clicks to "turn it on"; the server route is a **flip**, not a set (`project-notify.service.ts:32`), so it writes ON→OFF. The response says `notifyEnabled:false`, the optimistic map settles on false, and P silently stops paging the phone while the user believes they just enabled it.

Fix (either, preferably both):
- add `notifyEnabled` to `SessionUpsertedEvent['project']`, to the server-side payload that emits it, and to both rebuild sites;
- make the endpoint idempotent — `POST /:projectId/toggle-notify` body `{ notifyEnabled: boolean }`, service does a set, not `!current`. Removes the whole class of "client state divergence inverts the user's intent".

### 2. `src/hooks/useProjectsState.ts:113-127` — `projectsHaveChanges` does not compare `notifyEnabled`

The refetch reducer returns `prevProjects` unchanged when the only difference is the bell flag (it compares projectId/displayName/fullPath/isStarred/sessionMeta/sessions/taskmaster).

Failure scenario: the bell is toggled from the phone/second tab; this tab polls `/api/projects`, receives the new value, and discards it — the stale flag survives indefinitely, and the next click flips from the wrong base (see #1). Fix: add `Boolean(nextProject.notifyEnabled) !== Boolean(prevProject.notifyEnabled) ||` to the comparison.

### 3. `server/modules/notifications/services/notify-hub-config.service.ts:126` vs `:135` — PUT persists the URL before validating the timezone

`appConfigDb.set(url)` runs first; `validateTimezone` throws `NOTIFY_HUB_INVALID_TIMEZONE` (400) afterwards. There is no transaction.

Failure scenario: the operator edits both fields and typos the zone. The API answers 400 "Fuso horário inválido", the UI shows an error and keeps showing the *old* config (the response carries no config), but the new URL is already live — the next run pushes to the newly saved endpoint the user believes was rejected. Fix: validate url + timezone up front, then write all three keys (wrap in a single `db.transaction`).

---

## Minor

### 4. `useOptimisticProjectToggle.ts:33-44` — the optimistic map shadows server state for the component's lifetime

An entry is written on every toggle and never cleared, so `resolveState` prefers it over `projects` forever. After #1/#2 are fixed this still masks out-of-band changes until remount. Fix: delete the entry once the server round-trip confirms the value matches the list (or clear entries whose project row now agrees).

### 5. `useSidebarController.ts:527-533` — new hook props are inline literals

`readFlag`, `onError` are new closures each render, so `resolveState`/`toggle` change identity every render and `SidebarProjectSelector` re-renders on any sidebar state change. Wrap in `useCallback` (or hoist `readFlag` to module scope).

### 6. `useSidebarController.ts:465-595` — the star toggle was not migrated onto the new hook

The new hook's header comment says it exists "so the notify bell (and any future per-project toggle) doesn't need its own copy", but `toggleStarProject` keeps its own 60-line duplicate. Either migrate star (it needs the extra "project the list sorts on" projection) or drop the claim from the comment.

### 7. `notify-hub-config.service.ts:133-137` — the timezone cannot be cleared while `NOTIFY_TIMEZONE` is set

Saving an empty timezone writes `''`, which `readField` treats as absent and falls back to env. The UI will keep showing the env zone after the user clears the field. Same shape applies to url/token: there is no way to *unconfigure* the hub from Settings (url is required, empty token keeps the old one) — the only off switch is turning off every bell. Consider a delete/clear action, and a sentinel (or `NULL` row delete) for "explicitly empty".

### 8. `notify-hub-config.service.ts:74-80` — `source` is misleading when url and token come from different places

`source: 'db'` is reported if *either* credential came from the DB. The Settings badge "from environment variables" therefore disappears as soon as the url alone is saved, while the token still comes from env. Report per-field, or compute `source` from the pair.

### 9. `webhook-notify-channel.service.js:87` — archived projects still page

`projectsDb.getProjectPath` has no `isArchived` filter, so an archived project whose bell was left on keeps pushing if a session still emits for that path. Add `&& !project.isArchived` to the gate, or clear `notifyEnabled` on archive.

### 10. `notifications.routes.ts:144` / `notify-hub-config.service.ts:96-107` — arbitrary http(s) destination, blind SSRF surface

The stored URL is POSTed to with the bearer token attached, with no host allow-list and `http:` permitted (plaintext token on the wire). Single-user + `authenticateToken` makes this low-risk, and a self-hosted `http://localhost:8080/notify` is the intended default, so this is informational — but note that `POST /notify-hub/test` is a probe primitive (status code is echoed back at notify-hub-config.service.ts:178-184) for anything reachable from the server.

### 11. `notifications.routes.ts:158-183` — no per-event gate on the test push

`/notify-hub/test` builds its own Intl formatter with `config.timezone` and no `try/catch` around `new Intl.DateTimeFormat`. A DB row holding an invalid zone (only reachable if written outside `saveNotifyHubConfig`, e.g. env `NOTIFY_TIMEZONE` typo) throws `RangeError` → 500. The event path is safe (payload builder degrades, notify-hub-payload.js:50-61); mirror that here.

### 12. `webhook-notify-channel.service.js:155-170` — a pending permission push survives loss of the approval context

`cancelPendingPermissionWebhook` only fires from `waitForToolApproval`'s cleanup in `claude-sdk.js:101`. If the process holding the approval dies or the ws drops without an abort signal, the 60s timer still fires and pages "precisa de você" for an approval nobody can answer. Cheap mitigation: also cancel on `run.stopped`/`run.failed` for the same sessionId.

---

## Informational

- Phone push is still gated by `preferences.events[kind]` (notification-orchestrator.service.js:32-37) and by the dedupe window, not only by the hub config + bell. The channel comment ("not by user channel preferences") is accurate but the *event*-level preference silently disables the phone push too — worth a line in the Settings copy.
- Worktrees are their own project rows (`worktree-open.service.ts:57-77`, default `notifyEnabled = 0`), so enabling the bell on a repo does not cover its worktrees. Explicitly specced (spec.md:59, AD-018) — flagged only because this repo's normal workflow is worktree-heavy and the effect is silence, not noise.
- `readConfig()` runs twice per event (once in `isEnabled`, once in `dispatchIfAllowed`) = 6 sqlite reads per notification. Negligible at this volume; mention only so the "no cache" decision is a conscious one.
- i18n verified complete: `notifications.notifyHub` (16 keys incl. 3 status keys) and `tooltips.enableProjectNotifications` / `disableProjectNotifications` present in all 10 locales (en, de, fr, it, ja, ko, ru, tr, zh-CN, zh-TW). Card also carries `defaultValue` on every key.
- Bell button a11y is correct: sibling of the `role="menuitem"` button (no nesting), `aria-pressed` + `aria-label` + `title`, both states translated.

---

## Verdict

**SHIP-WITH-FIXES**

Blocking:
1. `useProjectsState.ts:324` / `:731-742` — propagate `notifyEnabled` through the WS-derived project rebuilds (and/or make the toggle route an idempotent set instead of a flip).
2. `useProjectsState.ts:113-127` — include `notifyEnabled` in `projectsHaveChanges`.
3. `notify-hub-config.service.ts:120-138` — validate before the first write / wrap the three `set` calls in one transaction.

Everything else on the list is non-blocking follow-up.
