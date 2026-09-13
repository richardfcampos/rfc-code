---
name: ak:diagram
description: >-
  Unified diagram surface — Mermaid, editorial diagrams (24 base types across
  architecture, flow, storytelling, data-viz), and animated SVG connectors.
  Use when the user wants a static image (PNG/SVG), a self-contained editorial
  HTML page, or a short video (MP4 default, GIF via --gif) of a diagram, and
  cares about visual quality on par with hand-crafted editorial work. Ideal
  for architecture reviews, sequence walkthroughs, loops, pyramids, quadrants,
  radars, timelines, bar/line/scatter/gantt, dark-mode variants, and animated
  connector flows. Deterministic byte-for-byte output.
user-invocable: true
when_to_use: >-
  Choose ak:diagram when the desired artifact is an editorial-grade image or
  short video with animation. Route to ak:excalidraw for editable canvases
  and codebase auto-maps, ak:graphify for large graph exploration, or
  ak:mermaid (if present) for a plain Mermaid render.
category: dev-tools
keywords: [diagram, mermaid, animation, architecture, flowchart, sequence, loop, pyramid, quadrant, radar, timeline, gantt, editorial, svg, png, mp4, gif]
metadata:
  author: agentkit
  version: "1.0.0"
  upstream_templates: cathrynlavery/diagram-design (MIT)
  vendored_mermaid_version: "11.4.1"
---

# ak:diagram — unified editorial diagram surface

Generate diagrams that read like a curated editorial page: strict ink-on-paper
palette, one accent for the eye, geometry that carries meaning, and optional
animation for flow. Three tiers of input, one deterministic pipeline out.

## Route carefully

`ak:diagram` overlaps other skills that also touch diagrams. Pick by artifact,
not by keyword — several skills mention "diagram" in their description.

| Task | Skill |
|------|-------|
| Static editorial PNG/SVG or animated MP4/GIF from a 24-type template | **ak:diagram** (this skill) |
| Plain Mermaid render, no editorial framing | ak:mermaid (if installed) or ak:diagram --input file.mmd |
| Editable Excalidraw canvas, MCP live editing | ak:excalidraw |
| Codebase auto-visualization ("diagram this repo") | ak:excalidraw |
| Large graph exploration, node/edge analytics | ak:graphify |
| Whiteboard-style hand-drawn look | ak:excalidraw |

`ak:preview` documents when a visual explanation is worth producing at all;
this skill executes once that decision is made.

## Three input tiers

**Tier 1 — Mermaid source (`.mmd`)**
Wraps the source in an editorial frame (tokens.css + vendored mermaid.min.js),
extracts SVG, screenshots PNG. Zero template lookup, fastest path.

**Tier 2 — Editorial template (`.json` spec + `--type <slug>`)**
Loads a vendored template from `assets/templates/<type>/<variant>.html` and
applies flat `{{key}}` slot replacement from the JSON spec. 24 base types ×
3 variants (light / dark / full) = 72 templates. See
`references/per-type-schemas/*.json` for the intended spec shape.

> **Current limitation:** upstream templates ship as finished exemplars with
> **no `{{key}}` slots declared yet**. Tier 2 is fully wired in `render.py`,
> but until slots are added to the templates the JSON spec's structured
> keys (`nodes`, `layers`, `series`, …) do not render. The workflow today:
> start from the vendored HTML, hand-customize the content, then render as
> Tier 3. Adding slots to selected templates is an incremental follow-up.

**Tier 3 — Raw HTML (`.html`)**
Passes through untouched. Use when you already composed a page or want to
render an artifact from another tool.

## Output artifacts

For each render call the pipeline emits (opt-out via flags):
- `<basename>.html` — self-contained, animated, mobile-safe
- `<basename>.png` — frozen final frame at 2× DPI (deterministic)
- `<basename>.svg` — extracted SVG source when present

For `record.py` the pipeline emits:
- `<basename>.mp4` (h264, crf=18) — default
- `<basename>.gif` — palette-generated GIF when `--gif` is passed

## Setup

```bash
# One-time dep probe (never installs anything on your behalf)
python3 kits/engineer/skills/ak-diagram/scripts/doctor.py

# Vendor / re-vendor upstream templates (idempotent)
git clone --depth 1 https://github.com/cathrynlavery/diagram-design.git /tmp/dd-src
python3 kits/engineer/skills/ak-diagram/scripts/vendor_from_upstream.py --source /tmp/dd-src
```

The skill uses the shared skill venv when available: `.claude/skills/.venv/bin/python3`.
Chromium is pre-installed under `/opt/pw-browsers/`. `ffmpeg` is optional
(needed only for `record.py`).

## Common tasks

**Render a Mermaid diagram to PNG + SVG:**
```bash
python3 scripts/render.py --input diagram.mmd --out ./build/
```

**Render an editorial loop from a JSON spec:**
```bash
cat > loop.json <<'EOF'
{
  "variant": "light",
  "title": "Fast-feedback loop",
  "nodes": ["Observe","Orient","Decide","Act"]
}
EOF
python3 scripts/render.py --input loop.json --type loop --out ./build/
```

**Record an animation to MP4:**
```bash
python3 scripts/record.py --input diagram.html --out clip.mp4 --duration 6 --fps 30
python3 scripts/record.py --input diagram.html --out clip.gif --gif --duration 4 --fps 20
```

**Verify goldens haven't drifted (pinned Chromium/font profile required):**
```bash
uv venv .snapshot-venv
uv pip install --python .snapshot-venv/bin/python -r references/snapshot-requirements.txt
PLAYWRIGHT_BROWSERS_PATH=.snapshot-browsers .snapshot-venv/bin/python -m playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.snapshot-browsers .snapshot-venv/bin/python scripts/snapshot_test.py --all
# After an intentional visual change, replace --all with --update-goldens.
```

## Animation effects

Eight zero-dependency SVG connector effects live in
`assets/connector-effects.css`. Apply via `data-fx="<name>"` on any `<path>`:

| Effect | data-fx | What it does |
|--------|---------|--------------|
| marching-ants | `marching-ants` | dashed stroke slides along the path |
| comet | `comet` | short bright segment travels along the path |
| wave | `wave` | sinusoidal amplitude on stroke width |
| morse | `morse` | dot-dash pattern travels along the path |
| glow | `glow` | pulsing drop-shadow |
| silhouette | `silhouette` | tiny shape rides the path via offset-path |
| pulse | `pulse` | opacity + width breath |
| dashed-flow | `dashed-flow` | slow dash-drift for background flows |

Full effect catalog with CSS variable knobs is in `references/animation-effects.md`.
Reduced-motion is respected automatically — effects freeze under
`prefers-reduced-motion: reduce`.

## Determinism

- Vendored `mermaid.min.js` is pinned to a specific version and hashed.
- `document.getAnimations().currentTime = duration; a.pause()` freezes every
  animation before screenshot, so the PNG byte-hash is stable.
- Chromium launched with `--font-render-hinting=none --disable-lcd-text` to
  strip subpixel drift.
- Video capture steps `currentTime` frame-by-frame instead of using vsync-based
  `record_video`, so MP4 output is reproducible across runs.

Golden PNG hashes live in `references/snapshot-hashes.yaml`. Snapshot verification
requires Chromium 151.0.7922.34 and the recorded generic plus effective
Geist/Geist Mono/Instrument Serif font-stack metrics; another renderer profile
refuses to compare instead of reporting a misleading byte-hash drift. Any
intentional visual change requires re-running
`scripts/snapshot_test.py --update-goldens` in that profile and committing the
updated hashes.

## References

- `references/animation-effects.md` — full effect catalog + CSS var API
- `references/mermaid-input.md` — Mermaid-specific tips and constraints
- `references/per-type-schemas/` — one JSON schema per editorial type
- `references/vendoring-metadata.yaml` — upstream provenance + template hashes
- `references/snapshot-hashes.yaml` — golden PNG byte-hashes

## Attribution

Editorial templates vendored from
[cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)
(MIT). Animation concepts adapted (not vendored) from
[ngothanhtung/flow-diagram](https://github.com/ngothanhtung/flow-diagram).
Mermaid v11 (MIT) vendored at `assets/mermaid.min.js`.
See `kits/core/skills/third-party-notices.md` for the full attribution ledger.
