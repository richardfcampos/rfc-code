# Design Quality Preflight (shared across design skills)

Canonical, medium-agnostic anti-slop gate for every AgentKit skill that produces a visual design artifact: `ak:frontend-design`, `ak:design` (logo, CIP, slides, banner, icon, poster, social photos), `ak:slides`, `ak:show-off`. Any skill that generates or reviews a visual deliverable runs this before calling the work done.

This file owns the *medium-agnostic* definitions and gates. HTML/CSS-specific numerics (spacing scale, contrast ratios, motion timing, font counts) and the exhaustive Absolute Bans table live in `ak:frontend-design`'s own SKILL.md — defer to that skill by name for anything code-specific. Restating a number here would create two sources of truth.

## 1. Design Read declaration — mandatory, before producing anything

One line, stated out loud before work starts:

`Reading this as: <deliverable kind> for <audience>, leaning <aesthetic direction>.`

If the brief is genuinely ambiguous, ask exactly ONE clarifying question — never a question dump. This line forces brief inference before a skill's default aesthetic fires; skipping it is how mode-collapse (the same purple gradient, the same three cards) happens regardless of medium.

## 2. Converged failure-mode catalog

Six patterns that read as "AI made this" regardless of medium (web page, slide deck, poster, logo, banner, icon, showcase page). Each is **default-off**, not an absolute ban — see the override clause below.

1. **Generic AI gradients/palettes** — the reflex purple-to-blue gradient, oversaturated evenly-distributed color wheels, or a warm cream/beige background reached for by default rather than derived from the brief.
2. **Centered-hero + equal-card-rows template** — a centered headline over three (or four) identical icon-heading-text cards. The single most recognizable "AI template" silhouette across every medium.
3. **Fake artifacts built from empty boxes** — div-built dashboards, screenshot mockups, or product shots assembled from placeholder rectangles instead of real content, real screenshots, or a labeled TODO.
4. **Generic content** — placeholder names ("John Doe", "Acme Corp"), invented testimonials, round fabricated numbers ("10,000+ customers"), stock logo marks, or lorem ipsum presented as if real.
5. **Decorative furniture without semantic purpose** — status dots, version stamps, eyebrow labels, or numbered section markers added as ornament rather than because they carry real state or sequence.
6. **One-note palettes / default component-library styling** — a single accent color reused for everything with no hierarchy, or shipping a component library's out-of-the-box look (default shadcn, default Bootstrap) with zero brand adaptation.

## 3. Priority order

Accessibility and product/brief fit outrank personal taste. A design that is inaccessible or misses the brief fails this gate even if it dodges every item above; a design that is accessible and on-brief but a little safe does not fail it.

## 4. Override clause

Every item above has a legitimate exception: the user explicitly asked for it, or the existing brand genuinely uses it. State the exception out loud when taking it — never silently. This mirrors `ak:frontend-design`'s Absolute Bans exception path and `ak:design`'s critique-guide "default-off" framing; both are restated once here for skills that inherit neither directly.

## 5. Where the code-specific version lives

For HTML/CSS/web output, `ak:frontend-design`'s own SKILL.md is authoritative: its Decision Procedure (Design Read + seeded variation + aesthetic thesis), Non-Negotiable Craft Rules (numerics), Absolute Bans (exhaustive, code-specific list), and Self-Review Gate supersede the condensed version above. This file exists for skills that produce non-code or mixed-medium design output (slides, posters, logos, banners, showcase copy) and need the converged pattern without re-deriving it.
