---
name: ak:brainstorm
description: "Turn unclear intent into an accepted outcome and compare viable approaches before delivery."
user-invocable: true
when_to_use: "Use at the opening of multi-step delivery or when a diagnosed problem has meaningful solution choices."
category: utilities
keywords: [ideation, tradeoffs, decisions, intent, acceptance]
license: MIT
argument-hint: "[topic or problem] [--advice] [--html] [--report] [--ultra] [--yagni] [--no-antv|--no-diagram-design|--no-editorial-visuals]"
metadata:
  author: agentkit
  version: "2.7.0"
  workflow:
    precedes: [ak-plan, ak-cook]
---

# Brainstorm

Turn incomplete intent into a bounded delivery contract. Stay honest about
evidence, trade-offs, and uncertainty without turning a clear request into a
ceremonial interview.

## Brainstorm contract

Every multi-step product, code, documentation, or maintainer delivery starts by
capturing:

- **Outcome:** the user-visible or operational end state.
- **Constraints:** safety, compatibility, time, technology, and ownership
  boundaries that shape the work.
- **Non-goals:** nearby work that this delivery will not absorb.
- **Acceptance criteria:** observable evidence that will prove completion.

An accepted design or plan satisfies the opening gate when it already contains
these fields. Reuse it and identify only material gaps; do not make the user
repeat settled decisions.

## Proportional behavior

- For a concrete request, summarize the four fields briefly and continue.
- Ask a concise question only when a missing answer would materially change the
  result, safety boundary, or public contract and cannot be discovered.
- Explicit autonomous execution may continue once the four fields are concrete;
  it does not require a routine approval pause.
- Direct answers and low-level read-only utilities do not require a design loop.
  If investigation turns into workspace mutation or delivery, satisfy the gate
  before that boundary.
- Separate target intent from current evidence. Inspect relevant repository or
  live state before claiming an approach is feasible.
- Separate uncertainty that can be discovered from uncertainty that cannot. Most
  unknowns are resolvable by reading source, docs, tests, or live state — resolve
  those instead of hedging against them. Reserve robustness reasoning for what
  stays unknowable at decision time, such as future requirements, third-party
  behavior, or audience response.

## Bug routing

For bugs, start by framing the expected repaired behavior, constraints,
non-goals, and acceptance evidence. Do not propose fixes from the symptom.

1. Scout the affected path and capture the failing state.
2. Diagnose and prove the root cause.
3. Compare cause-aligned solutions only after diagnosis.
4. Use a full options discussion when multiple viable fixes or an architecture
   decision remain; otherwise record why the direct fix is sufficient.

This preserves brainstorm-first intent without allowing brainstorming to replace
root-cause analysis.

## Option exploration

When the work has a real design choice:

1. Inspect the smallest relevant source, docs, tests, and current plans.
2. State the confirmed constraints and any evidence gaps.
3. Present up to three viable approaches with meaningful trade-offs. For each,
   name the assumption it depends on most and the condition under which it fails
   first. Compare approaches on their worst plausible case, not only their best.
4. Recommend the smallest approach that satisfies the contract. When a
   load-bearing assumption cannot be resolved now, prefer the approach that is
   cheapest to abandon.
5. Resolve material disagreement before implementation begins.

Challenge assumptions with evidence. Apply KISS and DRY. Deliver the full
requested scope — never trim or defer what the user explicitly asked for. Do not
invent extra components, migrations, or governance to make a design look
complete. With `--yagni`, additionally challenge and cut any scope not needed for
the stated outcome.

## Authoritative flow

```mermaid
flowchart TD
    A[Request] --> B{Multi-step delivery?}
    B -->|No| C[Answer or read-only utility]
    B -->|Yes| D{Accepted contract exists?}
    D -->|Yes| E[Reuse outcome, constraints, non-goals, acceptance]
    D -->|No| F[Capture bounded brainstorm contract]
    E --> G{Bug or failure?}
    F --> G
    G -->|Yes| H[Scout and diagnose root cause]
    H --> I[Choose cause-aligned solution]
    G -->|No| J[Inspect relevant evidence]
    J --> K[Compare approaches when choice is material]
    I --> L[Plan or fix]
    K --> L2[Plan or cook]
```

The opening contract is always first for delivery. Detailed solution exploration
may occur later when diagnosis or inspection provides the evidence it needs.

## Handoff

Pass the four contract fields, chosen direction, evidence, and unresolved risks
to the next owning workflow:

- feature or documentation delivery: the installed plan skill, then `/ak:cook`;
- diagnosed bug: `/ak:fix`;
- exploration only: report the recommendation and stop.

If the user passed `--yagni`, include the literal flag in every downstream skill
or subagent handoff. Otherwise, do not introduce it during handoff.

Write a durable summary only when the decision must survive the session or feed
a plan. Use the repository's configured report location and naming convention;
do not create a report merely to satisfy the gate.

## HTML Output Mode (`--html`)

When `--html` is present, capture the accepted brainstorm outcome as a
self-contained HTML brief the user can preview before delivery starts. The brief
augments the handoff; it never replaces the four contract fields passed to the
next workflow.

- Write `brainstorm.html` in the repository's configured report location.
  Self-contained: inline CSS and JavaScript, no build step, no network-required
  assets, safe to open directly from disk. Keep it accessible, responsive, and
  reduced-motion friendly.
- Include the four contract fields, the compared approaches with trade-offs, the
  recommendation and its rationale, and any unresolved risks or questions.
- **Implementation workflow diagram (required):** render at least one inline
  diagram (HTML/CSS/SVG) that visualizes what the chosen direction will build
  and how its steps or components connect — the delivery flow, not only the
  decision tree.
- **UI/UX mockups with annotations (required when the topic touches UI/UX):**
  embed annotated mockups of the proposed interface directly in the HTML so the
  user previews intended UI before planning. Derive layout, color, type,
  spacing, and component states from the project design guidelines
  (`docs/design-guidelines.md` when present, otherwise a restrained built-in
  editorial contract). Add callouts tying each element to design tokens,
  interaction states, and the acceptance evidence it satisfies.
- When the installed frontend-design skill is available, activate it before
  composing the HTML so the visuals follow current design intelligence.
- If image or diagram generation is unavailable, fall back to CSS/SVG structure
  and state the limitation in the final response; do not block the brainstorm.
- **Editorial visual layer (on by default, additive):** for approach comparisons, prefer the
  diagram-design Quadrant vernacular over a plain 2×2 table when
  `.prefs.visual.diagramDesign.enabled` (read from
  `ak config prefs resolve --json`). For KPI-shaped tiles (approach
  effort/impact scoring), prefer AntV Infographic `CandyCardLite` /
  `CompactCard` when `.prefs.visual.antv.enabled`. Nested keys arrive in
  the hook-facing camelCase spelling — `diagram_design` in `config.yaml`
  resolves as `diagramDesign` at that surface. Kill switches: `--no-antv`,
  `--no-diagram-design`, `--no-editorial-visuals`. See the sibling `ak-preview`
  skill's `../ak-preview/references/html-diagram-design.md` and
  `../ak-preview/references/html-antv-infographic.md` for exact template usage.

## Report Output Mode (`--report`)

When `--report` is present, persist the accepted brainstorm as a durable
markdown report following the installed project-organization skill's
conventions (path resolution, naming, and markdown body standards):

- **Path:** the plan-scoped reports directory (`plans/{plan-dir}/reports/`)
  when an active plan exists, otherwise the standalone `plans/reports/`
  directory — or the injected `Report:` path from the `## Naming` section when
  the runtime provides one.
- **Naming:** timestamped kebab-case per the naming convention, e.g.
  `brainstorm-{YYMMDD-HHmm}-{slug}.md`.
- **Body:** the report template — frontmatter, summary, the four contract
  fields, options considered with trade-offs, recommendation, and unresolved
  questions last.

`--report` composes with every other flag: with `--html` both artifacts are
written; with `--ultra` the report records the winning candidate plus the short
ranking appendix. Without `--report`, keep the existing behavior — write a
durable summary only when the decision must survive the session or feed a plan.

## Advisory supervision (`--advice`)

When `--advice` is present, run this skill under `kongming` supervision.
Load `references/advisory-supervision.md` for supervisor identity, host
detection, and model routing (Claude subscription → Fable 5; Codex →
`gpt-5.6-sol` + high effort; Cursor → `claude-fable-5-high`).

Spawn `kongming` at these checkpoints:

- **After each phase, step, or decision round completes** — pass the goal, what
  changed or was concluded, and the evidence; ask for a go/no-go and the next
  risk to watch before continuing.
- **When stuck** — repeated failures, a blocked step, or contradictory evidence;
  pass everything already tried and the exact obstacle.
- **Before a high-stakes decision** — a design fork, a public-contract or
  security-sensitive change, or an irreversible action; get counsel first.

**When the workflow reaches a PR** (here, via the handed-off plan/cook/fix
workflow): pass `--advice` to the downstream skill so supervision persists
across the handoff. Watch and fix CI until every required check is green, then
spawn `kongming` to review the whole implementation and post its assessment
plus concrete next steps as a comment directly on the PR and the source issue
(when one exists).

## Ultra Verifier Mode (`--ultra`)

When `--ultra` is present, run the brainstorm as a best-of-5 verifier pass
instead of a single draft. The controller builds one immutable evidence packet
plus a rubric, dispatches exactly five independent read-only candidate
brainstorms in one parallel wave, then a single strongest-model verifier scores
and ranks them and selects the winning candidate (or rejects all).

- **Candidate task:** each candidate produces a complete bounded contract —
  outcome, constraints, non-goals, acceptance criteria — plus its recommended
  direction and trade-offs.
- **Rubric:** faithfulness to the request, evidence grounding, sharpness of the
  acceptance criteria, and honesty about unknowns.
- **Finalizer:** the verifier selects the single winning contract; the
  controller emits that winner unchanged (it does not blend candidates) and
  records a short ranking appendix. On reject-all, hard-stop and report why.

Full mechanics — evidence packet, anonymization, the five-usable-candidate gate
with one bounded re-dispatch, the fail-closed runtime rule, and reject-all — are
in `references/ultra-verifier-mode.md`. `--ultra` composes with `--html`,
`--report`, `--advice`, and `--yagni`, and adds no new conflicts. It is a best-of-5 verifier
mode inspired by LLM-as-a-Verifier, not the full framework; never claim its
logprob/tournament algorithm.

## Boundaries

- This skill shapes intent and choices; it does not implement the solution.
- Never claim current behavior from intent alone.
- Never expose secrets or unrelated private files during inspection.
- List unresolved questions last when any remain.

## Workflow position

**Typically precedes:** `ak-plan`, `/ak:cook`.

**Bug path:** opening intent frame -> scout and debug -> solution brainstorm when
needed -> `/ak:fix`.
