# Structural refactor — CloudCLI to mockup parity

Reference renders: `renders/mock-desktop.png`, `renders/mock-mobile3.png` (tablet 834 / mobile 390 keyboard-up / mobile 390 drawer).
The token, typography and radius layer already shipped in `41470bf`. Everything below is structure and information architecture.

**Decision taken (2026-08-11):** full mockup fidelity for the sidebar — project dropdown plus status groups, replacing project-first navigation.

## Data availability — verified against the code

| Mockup element | Source | Verdict |
|---|---|---|
| `18 msgs` per session row | `ProjectSession.messageCount` (`src/types/app.ts:38`) | exists |
| `wt/usage-popover` badge | `ProjectSession.worktreeBranch` (`src/types/app.ts:48`) | exists |
| Relative age `<1m` / `2hr` | `ProjectSession.lastActivity` (`src/types/app.ts:37`) | exists |
| RUNNING group | `SessionActivityMap` from `useSessionProtection` | exists |
| NEEDS YOU group | `src/components/chat/utils/pending-permission-registry.ts` | exists |
| Footer `pessoal 61%` | `useProfileUsage` + profiles module | exists |
| Per-tool-call duration | `ToolResult.timestamp` minus the tool_use `timestamp` (`src/components/chat/types/types.ts:24,41`) | derive |
| Edit diff `+31 -9` | `createCachedDiffCalculator` in `useChatSessionState` | derive |
| Git tab count badge | git status already polled by the Git panel | verify while building; hide the badge if unavailable |

No new backend field is required for the mockup as drawn.

## Phases

Phases 1–5 have non-overlapping file ownership and can run in parallel. Phase 6 depends on them; Phase 7 closes.

### Phase 1 — Sidebar (owns `src/components/sidebar/**`)
Project selector dropdown showing name and path; "New session" with an `N` kbd badge; a `filter sessions` input matching title and branch, case-insensitive; sessions of the selected project grouped RUNNING / NEEDS YOU / RECENT with right-aligned counts, empty groups hidden; row = status dot + title + right-aligned age, second line `N msgs` plus worktree badge; selected row = accent left edge and tint; footer = profile avatar, name, usage percentage, settings icon.
Acceptance: matches the left column of `renders/mock-desktop.png` at 1440.

### Phase 2 — Header (owns `src/components/main-content/**`)
Drop the session title; tabs keep their labels and gain a superscript count badge on Git; right side carries the worktree chip, theme toggle and overflow menu.
Acceptance: item order and header height match the mockup; nothing regresses below 640px.

### Phase 3 — Tool-call group card (owns `src/components/chat/view/subcomponents/ToolGroupContainer.tsx` and `src/components/chat/tools/**`)
One card headed `N tool calls · <total duration>`; rows read `Read <path>` or `Edit <path> · +31 -9` with a right-aligned status dot and duration; expanding a row reveals line-numbered output with an `N more lines` footer.
Acceptance: durations are derived from timestamps and omitted when either timestamp is missing — never fabricated.

### Phase 4 — Thread chrome (owns `ChatMessagesPane.tsx`, `MessageComponent.tsx`, `Markdown.tsx` under `src/components/chat/view/subcomponents/`)
Session divider reading `SESSION 14:28 · RESUMED · 18 MESSAGES`; assistant speaker line `model · mode · time` in mono; ordered lists using `01/02/03` mono markers; a trailing turn summary `+38 -12 3 files` when the turn touched files.
Acceptance: the divider appears only on resumed sessions; the summary is omitted when no file changed.

### Phase 5 — Composer (owns `ChatComposer.tsx` and `ActivityIndicator.tsx`)
Chip order: image, mic, `Plan Mode` with status dot, `Worktree`, model, gauge, `ctx 12.4k`, `</>` with count badge, the hint `Enter to send · / for commands`, circular accent send. During a run a bar sits above the composer with the status text, elapsed time and Stop; the placeholder becomes `Queue your next message…` and send becomes a stop square.
Acceptance: matches the mockup composer at 1440 and its compact form at 390.

### Phase 6 — Tablet and mobile (owns `src/components/app/AppContent.tsx` plus responsive classes in the files above)
Tablet 834: the sidebar collapses to an icon rail holding the logo, one dot-badged icon per running session, a plus, search, and the profile. Mobile 390: header becomes hamburger + title + `wt/branch · N msgs` + overflow; tabs go icon-only with the badge; the drawer is 85vw over a scrim.

### Phase 7 — Review and ship
Render the running app headless at 1440, 834 and 390, compare against the mockup renders, then run typecheck, lint, the full test suite and the build before committing.

## Rendering the app for comparison

```
~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome --headless --no-sandbox \
  --disable-gpu --hide-scrollbars --screenshot=/tmp/app.png --window-size=1440,1600 "<app url>"
```
