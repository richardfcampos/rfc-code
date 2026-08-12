# CloudCLI "Precision Instrument" Redesign — Design Spec

Source of truth extracted from two Claude Design HTML exports:
- **Desktop (canonical, 1440):** `/home/richard/.cloudcli/assets/1786451943657-229051400-CloudCLI_-_Chat_Desktop.html`
- **Tablet (834) / Mobile (390):** `/home/richard/.cloudcli/assets/1786451943729-886331177-CloudCLI_-_Tablet___Mobile.html`

Both files are self-extracting bundler exports — the real markup/CSS lives inside a JSON string in
`<script type="__bundler/template">`. Unescaped copies used for this analysis were written to
`/tmp/desktop.html` and `/tmp/tablet.html` (not committed; regenerate with the same
`json.loads()` trick on line 384/line-index-383 of each source file if you need to re-inspect them).

The two files' shared token block (`:root` / `[data-theme="light"]` / base primitives) is
**byte-identical** — no conflicts to resolve there. Component CSS overlaps almost entirely; deltas
are purely responsive (noted in §5).

---

## 1. Design tokens

All colors are defined as CSS custom properties on `:root` (dark, primary/default) with a
`[data-theme="light"]` override block. Radii, motion, type, and elevation tokens are theme-agnostic.

### 1.1 Dark theme (primary/default)

| Token | Hex / raw | HSL (`H S% L%`) | Closest shadcn/codebase token |
|---|---|---|---|
| `--bg` | `#101214` | `210.0 11.1% 7.1%` | `--background` |
| `--surface` | `#17191C` | `216.0 9.8% 10.0%` | `--card` / `--popover` |
| `--surface-2` | `#1D2024` | `214.3 10.8% 12.7%` | `--secondary` / `--muted` |
| `--border` | `#26292E` | `217.5 9.5% 16.5%` | `--border` / `--input` |
| `--border-strong` | `#33373D` | `216.0 8.9% 22.0%` | no equivalent — new token needed |
| `--text` | `#ECEDEE` | `210.0 5.6% 92.9%` | `--foreground` |
| `--muted` | `#8B9096` | `212.7 5.0% 56.7%` | `--muted-foreground` |
| `--faint` | `#54585E` | `216.0 5.6% 34.9%` | no equivalent — new token (dimmer than `--muted-foreground`) |
| `--idle` | `#3B3F45` | `216.0 7.8% 25.1%` | no equivalent — new token (default/idle status dot) |
| `--accent` | `#2563EB` | `221.2 83.2% 53.3%` | `--primary` — **exact HSL match to current codebase's dark `--primary` already** |
| `--accent-hover` | `#1D4FD7` | `223.9 76.2% 47.8%` | no equivalent — new token |
| `--accent-ink` | `#FFFFFF` | `0.0 0.0% 100.0%` | `--primary-foreground` |
| `--success` | `#16A34A` | `142.1 76.2% 36.3%` | no equivalent — new semantic token |
| `--warning` | `#D97706` | `32.1 94.6% 43.7%` | no equivalent — new semantic token |
| `--danger` | `#DC2626` | `0.0 72.2% 50.6%` | `--destructive` (current dark destructive is `0 62.8% 30.6%` — darker/desaturated; export's is brighter) |

Overlay/tint tokens (kept as rgba, not HSL triplets — used directly, not through the
`hsl(var(--x))` wrapper pattern):
- `--hover: rgba(236,237,238,0.06)` — text-tinted hover wash
- `--hover-soft: rgba(236,237,238,0.03)`
- `--scrim: rgba(8,9,10,0.62)` — drawer/modal backdrop
- `--accent-tint: rgba(37,99,235,0.08)` — selected row background
- `--accent-line: rgba(37,99,235,0.30)` — selected row border
- `--accent-line-strong: rgba(37,99,235,0.50)` — active chip border
- `--success-tint: rgba(22,163,74,0.08)`, `--success-line: rgba(22,163,74,0.35)`
- `--warning-tint: rgba(217,119,6,0.08)`, `--warning-line: rgba(217,119,6,0.35)`
- `--danger-tint: rgba(220,38,38,0.08)`, `--danger-line: rgba(220,38,38,0.45)`

### 1.2 Light theme (`[data-theme="light"]` override)

| Token | Hex | HSL | Closest shadcn/codebase token |
|---|---|---|---|
| `--bg` | `#F6F7F8` | `210.0 12.5% 96.9%` | `--background` (current light bg is `44 22% 96%` — warm off-white vs. this cool near-white) |
| `--surface` | `#FFFFFF` | `0.0 0.0% 100.0%` | `--card` |
| `--surface-2` | `#F0F2F4` | `210.0 15.4% 94.9%` | `--secondary` / `--muted` |
| `--border` | `#E3E6E9` | `210.0 12.0% 90.2%` | `--border` |
| `--border-strong` | `#CBD0D6` | `212.7 11.8% 81.8%` | new token |
| `--text` | `#16181B` | `216.0 10.2% 9.6%` | `--foreground` |
| `--muted` | `#6B7280` | `220.0 8.9% 46.1%` | `--muted-foreground` |
| `--faint` | `#B0B4BA` | `216.0 6.8% 71.0%` | new token |
| `--idle` | `#C7CBD1` | `216.0 9.8% 80.0%` | new token |

Light theme does **not** override `--accent`, `--success`, `--warning`, `--danger`, or the tint/line
rgba tokens — they're shared across both themes (accent stays `#2563EB` in light mode too). It does
override: `--hover: rgba(22,24,27,0.05)`, `--hover-soft: rgba(22,24,27,0.03)`,
`--scrim: rgba(22,24,27,0.35)`, `--shadow-pop: 0 8px 24px rgba(16,18,20,0.10)`,
`--shadow-float: 0 10px 30px rgba(16,18,20,0.09)`.

### 1.3 Elevation

- `--shadow-pop: 0 8px 24px rgba(0,0,0,0.35)` (dark) / `rgba(16,18,20,0.10)` (light) — popovers (usage popover)
- `--shadow-float: 0 10px 30px rgba(0,0,0,0.34)` (dark) / `rgba(16,18,20,0.09)` (light) — composer, drawer

---

## 2. Typography

Two font families only — no serif anywhere in either export:

- **`--font-ui: 'Inter', system-ui, -apple-system, sans-serif`** — all prose, labels, buttons, session titles, timestamps prose text.
- **`--font-mono: 'JetBrains Mono', 'SFMono-Regular', ui-monospace, monospace`** — every piece of *data*: file paths, tool names/args, token/context counts, timestamps inside metadata rows, chip labels, branch/worktree names, kbd hints, status labels, diff stat numbers, usage-meter percentages.

Both fonts are self-hosted via `@font-face` with full unicode-range subsetting (cyrillic, greek,
vietnamese, latin-ext, latin) — Inter in weights spanning the full range used (400/500/600 seen in
markup), JetBrains Mono likely just regular/medium (only weight 400/500 used in CSS).

Body default: `font-size:13px; line-height:1.5` on `<body>`.

### Type-role table (role → family, size, weight, letter-spacing, color)

| Role / class | Family | Size | Weight | Letter-spacing | Color |
|---|---|---|---|---|---|
| Body/base (`body`) | sans (Inter) | 13px | 400 | normal | `--text` |
| `.mono` (generic) | mono | inherit | 400 | 0.02em | inherit |
| `.micro` | mono | 11px | 400 | 0.02em | `--muted` |
| `.eyebrow` (section labels, e.g. "RUNNING") | mono | 10px | 400 | 0.08em, uppercase | `--faint` |
| Brand name (`.brand-name`) | sans | 13px | 600 | -0.01em | `--text` |
| Project name (`.proj b`) | sans | 12px | 500 | normal | `--text` |
| Project path (`.proj .br`) | mono | 10px | 400 | 0.02em | `--muted` |
| Session group label (`.grp .lbl`) | mono | 10px | 400 | 0.08em, uppercase | `--faint` |
| Session group count (`.grp .n`) | mono | 10px | 400 | 0.02em | `--faint` |
| Session title (`.sess-title`) | sans | 13px | 400 | normal | `--text` |
| Session msg count (`.sess-sub .m`) | mono | 10px | 400 | 0.02em | `--muted` |
| Worktree tag (`.wt`) | mono | 10px | 400 | 0.02em | `--muted` |
| Session age/timestamp (`.sess .age`) | mono | 11px | 400 | 0.02em | `--muted` |
| Sidebar user (`.side-foot .who`) | sans | 12px | 400 | normal | `--text` |
| Usage percent (`.side-foot .use`) | mono | 11px | 400 | 0.02em | `--muted` |
| Tab label (`.tab`) | sans | 13px | 500 | normal | `--muted`→`--text` on select |
| Tab badge count (`.tab .n`) | mono | 10px | 400 | 0.02em | `--faint` |
| kbd hint (`.kbd`) | mono | 10px | 400 | 0.02em | `--muted` |
| Chat rule/divider (`.rule`) | mono | 10px | 400 | 0.06em, uppercase | `--faint` |
| User message body (`.msg-user`) | sans | 13px | 400 | normal, line-height 1.55 | `--text` |
| `@mention` in message (`.at`) | mono | 12px | 400 | 0.02em | `--accent` |
| Model/speaker name (`.turn-head .who`) | mono | 11px | 500 | 0.02em | `--text` |
| Turn metadata (`.turn-head .meta`, e.g. "plan mode · 14:29") | mono | 11px | 400 | 0.02em | `--faint` |
| Assistant prose (`.prose`) | sans | 13px | 400 | normal, line-height 1.65 | `--text` |
| Inline code (`.prose code`) | mono | 12px | 400 | 0.02em | `--muted` (on `--surface` chip bg) |
| Numbered step index (`.step .n`) | mono | 11px | 400 | 0.02em | `--faint` |
| Tool group header (`.tools-head`) | mono | 11px | 400 | 0.02em | `--muted` |
| Tool name (`.tool-name`) | mono | 11px | 500 | 0.02em | `--text` |
| Tool argument/path (`.tool-arg`) | mono | 11px | 400 | 0.02em | `--muted` |
| Tool duration (`.tool-meta .d`) | mono | 11px | 400 | 0.02em | `--faint` |
| Tool output/terminal text (`.tool-out`) | mono | 11px | 400 | 0.02em, line-height 1.75 | `--muted` (line no. `--faint`, highlighted `--text`, success `--success`) |
| Diff stat (`.diffbar`) | mono | 11px | 400 | 0.02em | add `--success`, del `--danger` |
| Chip label (`.chip`) | mono | 11px | 500 | 0.02em | `--text` |
| Composer placeholder (`.comp-body .ph`) | sans | 13px | 400 | normal | `--faint` |
| Composer hint ("Enter to send…") | sans | 11px | 400 | normal | `--faint` |
| Context/token chip (`.chip` "ctx 12.4k") | mono | 11px | 500 | 0.02em | `--text`, dim label via `.dim` = `--muted` |
| Usage popover title (`.pop-head .t`) | sans | 13px | 600 | normal | `--text` |
| Usage popover profile name (`.pname`) | sans | 12px | 500 | normal | `--text` |
| Usage popover tag (`.tag`) | mono | 10px | 400 | 0.02em | `--muted` (`.acc` variant → `--accent`) |
| Usage meter label (`.mlab`) | mono | 11px | 400/500 (key/value) | 0.02em | key `--muted`, value `--text` 500, reset note `--faint` |
| Locked state note (`.locked`) | mono | 10px | 400 | 0.02em | `--warning` |
| Activity "agent working" label (`.shimmer`) | sans | 12px | 500 | normal | animated gradient text (`--muted`→`--text`→`--muted`) |
| Activity elapsed timer (`.activity .elapsed`) | mono | 11px | 400 | 0.02em, `font-variant-numeric: tabular-nums` | `--muted` |
| Mobile title (`.mtitle b`) | sans | 13px | 500 | normal | `--text` |
| Mobile title subtext (`.mtitle span`) | mono | 10px | 400 | 0.02em | `--faint` |
| Mobile keyboard caption (`.kcaption`) | mono | 10px | 400 | 0.02em | `--faint` |

**Rule of thumb:** if it's a *value* (path, count, timestamp, id, percentage, branch name, duration,
model name) → mono, 10–11px, `letter-spacing: 0.02em` (or `0.06–0.08em` + uppercase for section
eyebrows). If it's *prose or a UI label a human wrote* (button text, tab label, message body,
session title) → Inter sans, 12–13px, no added letter-spacing (brand name gets `-0.01em` tightening).

---

## 3. Radius & spacing

### Radius scale (exactly 3 values, as expected)
```
--r-ctl:      6px   /* buttons, chips, inputs, tags, avatar, brand mark, focus ring */
--r-card:     10px  /* tool-group cards, message bubbles, popover cards, pcard */
--r-composer: 14px  /* composer surface, activity bar (top corners only when docked) */
```
No 4th radius value appears anywhere. `--r-composer` also drives the corner-fuse pattern: when an
`.activity` bar sits above a `.composer`, the composer gets `.docked` (`border-top-left/right-radius:0`)
so the two elements read as one continuous surface with a single 14px rounded top (on the activity
bar) and bottom (on the composer).

### Border widths
- `1px` is the universal border width (cards, inputs, dividers, chip/tag outlines).
- `2px` appears only for: focus-visible ring (`outline:2px solid var(--accent)`, 2px offset) and the
  active-tab underline (`::after`, `height:2px`, accent color, 2px inset from each edge).
- `3px` transparent border used as a scrollbar-thumb padding trick (`border:3px solid transparent;
  background-clip:content-box`) to shrink the visible thumb inside a 10px track.

### Spacing patterns
Fixed control heights recur constantly: **32px** (buttons, send button, `.proj`), **26–28px**
(chip, search field), **44px** (tab, tabbar, top app bar rows on mobile use 48px), **48px** (sidebar
header, mobile `.mtop`), **34–36px** (rail item, tool-head row).

Gap/padding scale in use: `2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28px` — no
strict 4/8pt grid; values cluster tightly around 6–12px for control-internal spacing and 16–28px for
section/panel padding. Notably many *odd* values (7px, 9px, 11px, 13px) are used for optical
centering inside fixed-height rows — this is a hand-tuned system, not generated from a spacing scale.

Thread column width is capped and centered: `max-width:780px` on desktop (`.thread-inner`), `680px`
on tablet/mobile. Composer/activity bar match that same max-width and are centered with `margin:0 auto`.

---

## 4. Component anatomy

### 4.1 Sidebar (`.side`)
Two states toggled by `.app[data-rail]`: full sidebar (`.side-full`, 264px, in `grid-template-columns`)
or icon rail (`.side-rail`, 56px). Background `--surface`, right border `1px solid var(--border)`.

- **`.side-head`** (48px): brand mark (22×22px, `--r-ctl`, `--accent` bg, terminal icon) + brand name
  (13px/600/-0.01em) + collapse `.btn--icon` pushed right via `margin-left:auto`.
- **`.side-top`**: project switcher button `.proj` (32px row, folder icon + bold project name + mono
  muted path + chevron), a `New session` outline button + `N` kbd hint side-by-side, and a mono
  search input (`.search`, 28px, no border until `:focus-within`).
- **`.side-scroll`**: grouped session list. Group header `.grp` = eyebrow label (uppercase mono,
  10px, `--faint`) + count on the right. Each session row `.sess`:
  - status `.dot` (6px circle) at top-left: default `--idle` gray, `.dot--run` = accent + `pulse`
    keyframe animation (1.6s, box-shadow ring), `.dot--attn` = `--warning` solid, `.dot--ok` = `--success`.
  - title (13px), subtitle row with message count (mono, muted) + optional worktree chip `.wt`
    (branch icon + name, or plain "permission" text tinted `--warning` when the session needs
    attention) + right-aligned relative age timestamp (mono, muted).
  - selected state (`aria-current="true"`): `background:--accent-tint`, `border:1px solid --accent-line`.
- **`.side-foot`**: avatar (22px mono initial in bordered square) + username + right-aligned usage
  percent (mono) + settings icon button.
- **Rail mode** (`.side-rail`): same session list collapsed to 36×36px icon buttons (`.rail-item`)
  with the terminal icon + a corner status dot (2px ring cutout matching `--surface` to punch through
  the icon), separated from "new session" by a `.rail-sep` divider line.

### 4.2 Top tab bar (`.tabbar`)
44px row, bottom border. Tabs (`.tab`): icon + label (13px/500, muted→text on select), optional mono
badge count (`.n`, e.g. Git "3"). Selected tab gets a 2px accent underline pseudo-element inset 8px
from each edge — **not** a full-width underline. Right-aligned `.tabbar-right` holds a worktree chip,
theme toggle, and session overflow menu — all `.btn--icon`/`.chip`.

### 4.3 Message thread
- **Session divider** (`.rule`): centered mono eyebrow text ("session 14:28 · resumed · 18 messages")
  flanked by horizontal rule lines (flex `::before`/`::after`).
- **User message** (`.msg-user`): right-aligned bubble (`align-self:flex-end`), max-width 88%
  (desktop) / 90% (tablet), `--surface` bg, 1px border, `--r-card` radius, 13px/1.55. `@mentions`
  rendered inline in accent mono.
- **Assistant turn** (`.turn`): no bubble/background at all — full-bleed against `--bg`, distinguishing
  it visually from the user's boxed message. Header row (`.turn-head`) = mono model name (11px/500)
  + mono metadata (mode, timestamp, 11px `--faint`). Body is `.prose` (13px/1.65) with support for
  inline `<code>` chips and a numbered `.steps` list (mono index + sans description).

### 4.4 Tool-call card
Grouped container `.tools` (`--surface` bg, 1px border, `--r-card` radius, `overflow:hidden`):
- **Group header** `.tools-head` (32px): code icon + mono "N tool calls" + right-aligned total
  duration.
- **Each tool row** `.tool` (34px collapsed, bottom-bordered, last child unbordered):
  `.tool-head` button = chevron (rotates 90° via `data-open="1"`) + mono tool name (500 weight) +
  mono argument/path (muted, truncated with ellipsis) + right-aligned meta cluster (status dot +
  mono duration).
  - **Expanded** (`data-open="1"`): `.tool-out` panel (`display:block`, top-bordered, `--bg` fill,
    padding `9px 12px 9px 31px` — the 31px left indent hangs the output under the tool name, past
    the chevron), monospace terminal-style output with per-line numbers (`.ln`, `--faint`,
    fixed 28px width), highlighted lines (`.hl`, `--text`), success marks (`.ok`, `--success`,
    e.g. "✓"), and a truncation footer ("14 more lines", 10px `--faint`).
- **Diff stat bar** (`.diffbar`, appears after a turn that edited files): mono `+N`/`−N` (success/danger)
  + file count in `--faint`.

### 4.5 Composer (`.dock` → `.composer`)
`.dock` is a `position:absolute` bottom bar with a fade-to-transparent gradient backdrop
(`linear-gradient(to top, var(--bg) 62%, transparent)`) so content scrolls under it cleanly;
`pointer-events:none` on the wrapper, `pointer-events:auto` on the inner content so the dead gradient
zone stays click-through.
- **Surface** `.composer`: `--surface` bg, 1px border (`--border-strong` on `:focus-within`),
  `--r-composer` (14px) radius, `--shadow-float`.
- **Text area** `.comp-body`: contenteditable-style div, 13px/1.55, placeholder in `--faint`,
  inline `@mentions` in accent mono, and a blinking accent-colored caret (`.caret`, 1px wide, `blink`
  keyframe 1.1s steps(1)).
- **Toolbar** `.toolbar` (flex row, 8px padding, `flex-wrap:nowrap`): icon buttons (attach image,
  voice mic) → `.sep` divider → mode chip ("Plan Mode" with a static accent dot + chevron) →
  worktree toggle chip (`.chip.is-on`, pressed/active state via `aria-checked`) → model chip
  ("claude-fable-5" + chevron) → `.sep` → usage-gauge icon button (opens the usage popover) →
  context-token chip ("ctx 12.4k", dim label prefix) → slash-command icon button with a numeric
  `.badge-n` overlay (accent pill, top-right corner, count of available commands) → right-aligned
  `.toolbar-right` = keyboard hint text + circular accent **send** button (32px, arrow-up icon).
  At `max-width:1240px` the `.hint` text is hidden first (composer toolbar degrades before anything
  else).

### 4.6 Activity indicator ("agent working" state)
**Only defined in the tablet/mobile export — absent from the desktop file's CSS and markup
entirely.** Class names: `.activity`, `.shimmer`, `.stop-mini`. Bar sits directly above the composer,
sharing its border/width and fusing corners via `.docked` (see §3). Contents: running status dot
(`.dot--run`, pulsing) → shimmer-animated label text (gradient sweep across `--muted`→`--text`→
`--muted`, 2s linear infinite, `background-clip:text`) describing the running command → right-aligned
mono elapsed timer with `tabular-nums` (prevents digit jitter) → a `.stop-mini` button (24px, square
icon + "Stop" label, outlined). When active, the composer's send button is replaced by a filled
square "stop" icon on a neutral (not accent) background. **This component must be built from scratch
for the desktop layout** — port the classes verbatim, they're layout-compatible with the 780px
desktop thread column.

### 4.7 Usage popover (`.pop`)
Anchored above the composer's usage-gauge button, centered (`transform:translateX(-50%)`), 328px
wide, `--surface`/1px border/`--r-card`/`--shadow-pop`. Opens via `data-open="1"` (opacity+translateY
transition, `--dur`/`--ease`). Header = title + refresh icon button. Body = one `.pcard` per profile
(bordered, `--r-ctl`, 10px padding): profile mark icon + name + provider tag chip(s, one highlighted
`.tag.acc` for "per-model") followed by stacked `.meter` rows — each a label line (`.mlab`: mono key
left / mono value+reset-note right) over a 3px `.track` with an accent `.fill` (turns `.fill.is-hot`
= `--warning` past a threshold, seen at 86% and 100%). A fully-consumed/blocked profile shows
`.locked` (warning-colored mono note with a small dot, "Locked until Tue 14:32") instead of further
meters.

### 4.8 Permission banner / empty state
**Neither component appears in either export.** The closest artifact is a session-row status chip
reading "permission" (muted `.wt` tag recolored to `--warning`/`--warning-line`) used in the sidebar
to flag a session that's blocked awaiting a permission decision — this is a *list-item affordance*,
not a banner. No empty-state markup (empty session list, empty thread, zero-results search) is present
in either file. Both must be designed net-new, following the token/typography system above (e.g. an
empty state would plausibly use `.eyebrow` + `.prose`-weight body text in `--faint`, an outline
button, centered in the `.thread` or `.side-scroll` region).

---

## 5. Responsive rules (from the tablet/mobile export)

### At 834px (tablet)
- Sidebar **always** renders as the 56px icon rail (`.rail`) — there is no expanded/full sidebar
  state shown at this width; a search icon button is added to the rail's icon list (not present in
  desktop's rail) since the search field has nowhere to live.
- Tab bar keeps text labels (per the export's own annotation: "sidebar drops to the icon rail, tab
  labels stay") — same `.tab`/`.tabbar` markup as desktop, unchanged.
  the mtabs (icon-only) layout at tablet).
- Thread padding shrinks to `18px 20px 150px` (from `20px 24px 200px`), column narrows to
  `max-width:680px` (from 780px), inter-block gap `18px` (from 20px).
- Composer/activity bar also narrow to `680px` max-width, centered.
- The activity ("agent working") bar is demonstrated at this breakpoint, docked to the composer.

### At 390px (mobile)
- Sidebar is replaced entirely by a **drawer** (`.scrim` + `.drawer`, 85% viewport width, slides from
  left, `--shadow-pop`), triggered by a hamburger icon in a new top app bar `.mtop` (48px: menu
  button 40×40 touch target, running-status dot, stacked title+subtitle `.mtitle`, overflow menu
  button). The drawer reuses the sidebar's session-list markup/classes (`.sess`, `.grp`, `.proj`)
  but wrapped in drawer-specific containers (`.d-head`, `.d-top`, `.d-list`, `.d-foot`) with taller
  row heights (`.proj` 36px vs 32px, `.sess` min-height 44px) for touch.
- Tab bar becomes **icon-only**, horizontally scrollable (`.mtabs`, `scrollbar-width:none`), with
  left/right edge fade gradients (`.fade`) hinting overflow, and badge counts moved to a small
  absolute-positioned corner label instead of inline text.
- Thread padding drops to `16px 14px 12px`, gap `16px`, and the `max-width` column constraint is
  **dropped** — content runs full width of the 390px frame.
- Composer moves to mobile-specific classes (`.mcomposer`, `.mtoolbar`) with a horizontally
  scrollable toolbar (same scrollbar-hiding trick) and all icon buttons/send button enlarged to
  36×36px (from 32×32px) for touch.
- **Keyboard-open state** is modeled explicitly: a `.kbd-block` mock keyboard (`--surface-2` bg,
  top border, 4 rows of `.key` blocks, mono caption below) sits directly under the composer, which
  itself sits on the keyboard inset — no gap.
- **Safe-area handling**: `.safe` (22px height, `--bg`) with a `.home-ind` bar (120×4px, `--border`,
  rounded) simulates the iOS home-indicator zone; this is the bottom safe-area padding pattern to
  replicate with `env(safe-area-inset-bottom)` in real CSS (the codebase already has
  `--safe-area-inset-bottom` plumbing in `src/index.css`).

---

## 6. Motion

All durations/easings are driven by two tokens: `--dur: 150ms` and `--ease: ease-out`. Everything
color/border-related transitions on those two tokens — no bespoke per-component timing.

| What | Transition/animation | Duration/easing |
|---|---|---|
| Buttons, chips, rail items, session rows, tab colors, composer border | `background-color`, `border-color`, `color` | `150ms ease-out` |
| Send button hover | `background-color` | `150ms ease-out` |
| Tool-row chevron expand | `transform: rotate(90deg)` | `150ms ease-out` |
| Meter fill width change | `width` | `150ms ease-out` |
| Usage popover open/close | `opacity`, `transform` (translateY 4px→0), `visibility` | `150ms ease-out` (visibility delay = `--dur`) |
| Running-session status dot | `pulse` keyframes — expanding/fading accent box-shadow ring | `1.6s ease-out infinite` |
| Composer text caret | `blink` keyframes — opacity 100→0→100 at the midpoint | `1.1s steps(1) infinite` |
| Activity "agent working" label | `shimmer` keyframes — gradient `background-position` sweep, text-clipped | `2s linear infinite` (matches the codebase's existing `tailwind.config.js` `shimmer` keyframe/animation almost exactly — same 2s linear timing, only the color stops differ) |
| Reduced motion | `@media (prefers-reduced-motion:reduce)` collapses all animation/transition durations to `0.01ms` and forces 1 iteration, `scroll-behavior:auto` | — |

No page-transition, route-change, or skeleton-loading motion is specified beyond the shimmer text
effect and the meter-fill width transition (used for progressive/streaming meter reveals per the
sidebar session titles referencing exactly that feature).

---

## 7. Deltas vs. current app

Current tokens read from `/srv/code/personal/rfc-code/src/index.css:24-120` and
`/srv/code/personal/rfc-code/tailwind.config.js`.

### Fonts — must swap
- **Current:** `fontFamily.sans = 'Encode Sans', ...` / `fontFamily.serif = 'Merriweather', ...`
  (Tailwind config), with a `--radius: 0.5rem` (8px) single radius token.
- **Target:** Inter (sans, self-hosted `@font-face` subsets) + JetBrains Mono (new — codebase has no
  mono family declared in `tailwind.config.js` at all today). The serif family (`Merriweather`) is
  **entirely absent** from the redesign — nothing in either export uses serif type. Drop the
  `serif` fontFamily key (or repoint it, but it's unused by the new design) and add a `mono`
  fontFamily key backed by `--font-mono`.

### Color tokens — values change, naming mostly maps
- Current uses a **warm** neutral palette in light mode (`--background: 44 22% 96%` — 44° hue,
  beige-tinted) and a **true neutral** dark mode (`0 0% 8%` / `0 0% 12%` — zero saturation). The
  redesign uses a **cool-neutral** palette in both themes (hues clustering 210–217°, low saturation
  ~9-13%) — every surface token needs its hue shifted from warm/neutral to cool-neutral, not just a
  lightness/contrast tweak.
- `--primary` is a very close match already: current dark `--primary: 217.2 91.2% 59.8%` vs. target
  `--accent: 221.2 83.2% 53.3%` (current *light* `--primary` is `221.2 83.2% 53.3%` — an **exact
  hue/sat/light match** to the target's single cross-theme accent). Net effect: the redesign wants
  **one accent value for both themes** (no separate dark-mode-brightened primary) — current app
  brightens primary for dark mode; new design does not.
  - **Signal to confirm with the user before changing:** current app's dark-mode primary lift
    (59.8% L vs 53.3% L) may be an intentional accessibility/legibility choice on very dark
    backgrounds — don't silently flatten it to the single accent value without checking contrast on
    the new darker `--bg` (`7.1%` L vs. current `8%` L, close enough that the concern likely carries over).
- `--destructive` current dark (`0 62.8% 30.6%`, quite dark/desaturated) vs. target `--danger`
  (`0 72.2% 50.6%`, notably brighter) — a real, visible change, not just a rename.
- **New tokens with no current equivalent** — need to be added, not mapped: `--border-strong`,
  `--faint` (dimmer tier below `--muted-foreground`), `--idle` (status-dot default gray),
  `--success`/`--success-tint`/`--success-line`, `--warning`/`--warning-tint`/`--warning-line`,
  `--danger-tint`/`--danger-line` (current `--destructive` has no tint/line rgba siblings),
  `--accent-tint`/`--accent-line`/`--accent-line-strong`, `--hover`/`--hover-soft` (text-tinted
  overlay washes — current app has no equivalent hover-wash token, relies on utility classes),
  `--scrim`, `--shadow-pop`/`--shadow-float` (current has no elevation/shadow tokens at all).
- Current `--secondary` and `--accent` (Tailwind shadcn slots) are **identically valued** to
  `--muted` in both themes today (e.g. dark: `secondary`, `muted`, and `accent` are all
  `0 0% 17%`) — the redesign differentiates `--surface` vs `--surface-2` (`10.0%` vs `12.7%` L) as
  two distinct tiers, so this collapsed 3-way tie needs to be split back out.

### Radius — scale must expand from 1 to 3 steps
- Current: single `--radius: 0.5rem` (8px) with Tailwind's `lg`/`md`/`sm` derived by subtracting
  2px/4px (giving 8/6/4px).
- Target: three independent, non-derived values — `--r-ctl:6px`, `--r-card:10px`,
  `--r-composer:14px`. None of these fall out of the current subtractive scale (closest current
  derived value is `sm:4px`, `lg:8px` — neither hits 6, 10, or 14). This needs three new CSS vars
  and three new Tailwind `borderRadius` keys (or direct `rounded-[6px]`/`[10px]`/`[14px]` arbitrary
  values), not a reuse of `lg`/`md`/`sm`.

### Motion — mostly already compatible
- Current `tailwind.config.js` already defines a `shimmer` keyframe/animation at `2s linear
  infinite` with the *same* timing as the redesign's `.shimmer` — only the gradient's color stops
  need updating to use the new `--muted`/`--text` tokens instead of whatever it currently references.
  `dialog-overlay-show`/`dialog-content-show` both already use `150ms ease-out`, matching the
  redesign's `--dur`/`--ease` tokens exactly — **no change needed there**, just formalize `--dur:
  150ms` and `--ease: ease-out` as explicit CSS custom properties so components stop hardcoding
  `150ms ease-out` ad hoc.

### Theme-switch mechanism differs
- Current app uses Tailwind's `darkMode:["class"]` strategy — dark mode is a `.dark` class on a
  root element, light is the unstyled default.
- Redesign uses `data-theme="dark"|"light"` attribute with **dark as the unstyled default** (`:root`)
  and light as the override (`[data-theme="light"]`) — i.e. the redesign inverts which theme is the
  "base" layer. Either keep the current `.dark` class mechanism and just re-point which theme's
  values live in the bare `:root` vs `.dark` selector, or migrate to `data-theme` to match the export
  literally — functionally equivalent, but pick one and update `ThemeProvider`/whatever toggles the
  class today accordingly (grep the codebase for `classList.toggle('dark')` or similar before
  deciding — out of scope for this spec, flag for the implementation agent).

### Safe-area / mobile-nav plumbing — already compatible, keep as-is
- `src/index.css` already has `--safe-area-inset-*` and `--mobile-nav-*` custom properties wired up
  with `env()` fallbacks matching the redesign's mobile safe-area treatment (§5) — no rework needed,
  just confirm the new mobile composer/keyboard-inset layout composes with the existing
  `--mobile-nav-total` variable rather than fighting it.
