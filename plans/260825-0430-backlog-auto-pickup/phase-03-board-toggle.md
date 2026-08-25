# Phase C — Board auto-pickup toggle

## Context Links

- Spec (authoritative): `docs/superpowers/specs/2026-08-25-backlog-auto-pickup-design.md` §Board UI
- REST surface: `server/modules/automations/automations.routes.ts:50-125`
- Write semantics: `server/modules/automations/services/automation-admin.service.ts:90-136`

## Overview

- **Priority:** P2
- **Status:** pending
- **Effort:** 2h
- A switch plus a numeric limit field in the board header, backed by the single
  well-known rule `board-auto-pickup:{projectId}` through the existing
  `/api/automations` CRUD.

**Fully parallel with A and B.** This phase depends only on the REST contract and the
rule-name convention — not on either server phase landing. It can be written, reviewed
and merged against a server that does not yet accept `task_backlog`; the toggle simply
returns an error from `POST` until Phase A ships.

## Key Insights

1. **`task.project_name` holds the `projectId`, not a name.** Confirmed on both sides:
   `useTaskBoard.ts:96` filters WS events with `task.project_name !== projectId`, and
   `useTaskBoardMutations.ts:28,45` writes `project_name: projectId` / posts
   `{ project: projectId }`. So `trigger_config.project` must be
   `selectedProject.projectId`. `action_config.projectPath` is a different thing —
   a real filesystem path, `selectedProject.fullPath`.

2. **A partial `trigger_config` PATCH is a 400.** `PATCH` is partial at the *top level*
   only (`automation-admin.service.ts:93-99` — sending just `{ enabled }` leaves
   `trigger_config` untouched, which is why the toggle is cheap). But the moment
   `trigger_config` is present, `validateTriggerConfig` re-validates it **from scratch**
   (`:107-122`), and the `task_backlog` validator requires `project`. Sending
   `{ trigger_config: { maxConcurrent: 5 } }` therefore fails with
   `trigger_config.project is required`. **The limit field must always send the full
   `{ project, maxConcurrent }` object.** This is the single easiest thing to get wrong here.

3. **`GET /api/automations` has no project filter** — it returns every rule
   (`automations.routes.ts:53-58`). The hook fetches all and finds its rule by
   `name === 'board-auto-pickup:' + projectId`. With one rule per board this is fine;
   no new endpoint is justified (the spec's YAGNI line, and the list stays tiny).

4. **No React Query, no shared client.** The board hooks are plain
   `useState`/`useEffect`/`useCallback` over `authenticatedFetch`, imported relatively
   (`useTaskBoard.ts:3`). Every response is the `{ success, data }` envelope. Error state
   is a boolean, not an `Error`. Mirror `useTaskBoardMutations.ts` — it is the closest
   template for a write path.

5. **No `Switch` and no `NumberInput` in the design system.** `SettingsToggle` is a
   hand-rolled `<button role="switch">` and a **default** export under
   `components/settings/view/`. The only bounded-number precedent in the frontend is
   `OrgCard.tsx:110-121` — `<Input type="number" min max>` with local state that
   commits **on blur or Enter**, not per keystroke.

6. **The frontend has never called `/api/automations`.** `grep -rn "automations" src/`
   is empty. This phase writes the first client and the first frontend types for it.

## Requirements

**Functional**
- Toggle reflects the rule's `enabled`; off when no rule exists.
- First enable **creates** the rule (`POST`); every later change **patches** it.
- Limit field is visible only when enabled, bounded 1–10, defaults to 2.
- Toggle and limit are disabled while a request is in flight; a failure reverts the control.
- Nothing renders when no project is selected.

**Non-functional**
- Each new file under 200 lines.
- i18n keys under the existing `taskBoard` namespace, with `defaultValue` inline.
- No new REST endpoint.

## The rule this hook manages

| Field | Value |
| --- | --- |
| `name` | `board-auto-pickup:{projectId}` — the lookup key |
| `trigger_kind` | `task_backlog` |
| `trigger_config` | `{ project: selectedProject.projectId, maxConcurrent: number }` |
| `action_kind` | `pickup_task` |
| `action_config` | `{ projectPath: selectedProject.fullPath }` |
| `enabled` | the toggle |

## Related Code Files

**Create**
- `src/components/task-board/view/AutoPickupToggle.tsx`
- `src/components/task-board/hooks/use-auto-pickup.ts`

**Modify**
- `src/components/task-board/view/TaskBoardTab.tsx` — mount, header at `:78-93`
- `src/components/task-board/types.ts` — the `AutomationView` mirror
- `src/i18n/locales/en/taskBoard.json` and `src/i18n/locales/pt-BR/taskBoard.json`

**Delete** — none.

## Implementation Steps

1. **Mirror the server type** in `src/components/task-board/types.ts`, following the
   existing mirror-comment convention at `:1-4` (the frontend keeps its own copy of
   server contracts rather than importing server modules):
   ```ts
   // Frontend mirror of the automations REST view
   // (server/modules/automations/automations.types.ts `AutomationView`).
   export interface AutomationView {
     automationId: string;
     name: string;
     enabled: boolean;
     triggerKind: string;
     triggerConfig: Record<string, unknown>;
     actionKind: string;
     actionConfig: Record<string, unknown>;
     createdAt: string;
     updatedAt: string;
   }
   ```
   `triggerConfig` arrives as `Record<string, unknown>`, so read `maxConcurrent` through
   a narrowing helper (`typeof v === 'number' ? v : 2`).

2. **Write `use-auto-pickup.ts`.** Signature
   `useAutoPickup(project: Project | null | undefined)` — it needs both `projectId`
   and `fullPath`, so take the project rather than an id. Follow `useTaskBoard.ts`
   structure exactly: a module-level `async fetchAutoPickupRule(projectId)` above the
   hook, a local response interface, `useCallback` + `useEffect` load, and the
   `requestSeqRef` guard at `:45-47` so a response for a superseded project cannot
   overwrite the current one.

   - `const RULE_NAME_PREFIX = 'board-auto-pickup:';` and
     `const DEFAULT_MAX_CONCURRENT = 2; const MIN = 1; const MAX = 10;`
   - Load: `GET /api/automations` → `body.data.automations` →
     `find((rule) => rule.name === RULE_NAME_PREFIX + projectId)`. Missing rule is a
     normal state (`enabled: false`), not an error.
   - `setEnabled(next: boolean)`:
     - no rule yet and `next === true` → `POST /api/automations` with the full body from
       the table above and `enabled: true`. (Do not POST when `next === false` — there is
       nothing to disable.)
     - rule exists → `PATCH /api/automations/{id}` with **`{ enabled: next }` only**.
       Omitting `trigger_config` is deliberate: it leaves the stored config untouched
       (`automation-admin.service.ts:108`).
   - `setMaxConcurrent(next: number)`:
     - clamp to 1–10 and round; ignore `NaN`.
     - `PATCH /api/automations/{id}` with the **complete**
       `{ trigger_config: { project: projectId, maxConcurrent: next } }`. Never send a
       partial config — see Key Insight 2.
     - When no rule exists yet, only update local state; the value is persisted by the
       `POST` on first enable.
   - Optimistic update with rollback in `catch`, and `throw error` re-raised, exactly as
     `useTaskBoardMutations.ts:64-67` does.
   - Return `{ enabled, maxConcurrent, isSaving, loadError, setEnabled, setMaxConcurrent }`.

3. **Write `AutoPickupToggle.tsx`.** Props: `{ project: Project | null }`. Calls the hook
   itself (self-contained, like the board's other controls).
   - Render nothing when `!project`.
   - A `<label className="flex items-center gap-1.5 text-xs text-muted-foreground">`
     wrapping `SettingsToggle` and the caption, mirroring `OrgCard.tsx:110-121`.
   - Import the toggle as `import SettingsToggle from '../../settings/view/SettingsToggle';`
     — a **default** import, and the first cross-feature use of it. If that reach reads
     badly in review, promote the component to `src/shared/view/ui/` instead and update
     the four existing importers; do not fork a second copy.
   - Limit field only when `enabled`: `<Input type="number" min={1} max={10} className="h-8 w-16 text-right">`
     with local state, committing on blur and on Enter (`OrgCard.tsx:116-119`).
     `Input` comes from the barrel: `import { Input } from '../../../shared/view/ui';`
     (`TaskBoardTab.tsx:5` already imports this way).
   - `disabled={isSaving}` on both controls; render `loadError` inline and quietly.
   - `aria-label` on the switch — `SettingsToggle` requires `ariaLabel`.

4. **Mount it.** In `TaskBoardTab.tsx`, the header `div` at `:78` is currently
   `className="flex-shrink-0 border-b border-border p-3"` with the quick-add `Input` as
   its only child. Make it a row and let the input take the slack:
   ```tsx
   <div className="flex flex-shrink-0 items-center gap-2 border-b border-border p-3">
     <Input … className="flex-1" />
     <AutoPickupToggle project={selectedProject} />
   </div>
   ```
   The early return at `:47-56` guarantees `selectedProject` is non-null below it.

5. **i18n.** Add to both locale files under `taskBoard`:
   `autoPickup.label` ("Auto-pickup"), `autoPickup.limitLabel` ("Limit"),
   `autoPickup.error` ("Could not update auto-pickup"). Use
   `t('autoPickup.label', { defaultValue: 'Auto-pickup' })` so the UI works before the
   JSON lands.

## Todo List

- [ ] `AutomationView` mirror added to `types.ts`
- [ ] `use-auto-pickup.ts` with find-or-create + `requestSeqRef` guard
- [ ] Enable/disable sends `{ enabled }` only
- [ ] Limit sends the **full** `{ project, maxConcurrent }`
- [ ] `AutoPickupToggle.tsx` with switch + conditional bounded number field
- [ ] Mounted in the board header; layout still correct at narrow widths
- [ ] i18n keys in `en` and `pt-BR`

## Test Matrix

No frontend test harness exists for board hooks (the `npm test` glob covers
`src/**/*.test.ts`, but `src/components/task-board/` currently has none). Keep this
phase's verification manual unless a harness is added:

- first enable on a fresh project issues exactly one `POST`, then the toggle stays on after reload
- second toggle issues a `PATCH`, never a second `POST`
- changing the limit to 5 persists across reload
- setting the limit while disabled does not fire a request
- a failing request reverts the control and surfaces the error
- switching projects mid-request does not show the previous project's state

If a hook harness is added, mirror the node:test + `assert/strict` style used
server-side and stub `authenticatedFetch`.

## Success Criteria

- `npm run typecheck` clean for the root `tsconfig.json`.
- `npm run lint` clean for `src/`.
- Toggling on a project with Phases A+B deployed creates exactly one rule named
  `board-auto-pickup:{projectId}`, visible in `GET /api/automations`.
- Reloading the board restores toggle and limit from the server.

## Risk Assessment

| Risk | L×I | Mitigation |
| --- | --- | --- |
| Partial `trigger_config` PATCH 400s | High×Med | Always send the complete object; called out in step 2 |
| `project` set to `displayName`/`fullPath` instead of `projectId` | Med×High | Rule table above; `project_name` holds the id, verified on both sides |
| Duplicate rules from a double click | Med×Med | `isSaving` disables the control; a stray duplicate is deletable via REST |
| Cross-feature import of `SettingsToggle` rejected in review | Med×Low | Promote to `src/shared/view/ui/` — decided in review, not blocking |
| Rule survives project deletion | Low×Low | Harmless: the trigger finds no tasks. Out of scope per the spec. |

## Security Considerations

- All calls go through `authenticatedFetch` (`src/utils/api.js:15-42`), which attaches
  the JWT from `localStorage['auth-token']`; the management router is behind
  `authenticateToken`.
- `projectPath` is sent from the client, so any user who can reach the board can point a
  rule at a path they can already open as a project. Same trust level as the existing
  worktree UI — no new exposure, but worth a reviewer's glance.

## Rollback

Revert the commit; the board loses the control and any created rules keep running until
deleted. To fully disable, `PATCH { enabled: false }` or `DELETE` the rule.

## Next Steps

Phase D smoke-tests the full loop.

## Unresolved Questions

1. Should the toggle be hidden when the server does not support `task_backlog` yet
   (feature detection), or always shown? Planned: always shown — C may merge before A/B,
   and the failure is a visible error rather than a silent no-op.
2. Does the board header have room for the control at narrow widths, or should it move
   into an overflow menu? Needs a designer's eye during review.
