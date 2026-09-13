---
name: ak:journal
description: "Write chronological technical journals for session reflection and change analysis. Journals preserve work history; they do not replace current docs or ADRs."
user-invocable: true
when_to_use: "Invoke for technical session reflection or chronological work records."
category: utilities
keywords: [journal, reflection, changes, session]
argument-hint: "[topic or reflection]"
metadata:
  author: agentkit
  version: "1.3.0"
---

# Journal

Capture a concise technical journal for the current session, then persist it with the first-class CLI.

Journals are work history under `<project>/plans/journals/`. They are not durable product or decision authority — record lasting decisions in the project's ADR or current docs owner.

## Workflow

1. Gather the important events: root cause, key changes, impacts, decisions, and next steps.
2. Draft a short title and body (markdown). Prefer concrete errors, paths, and outcomes over vague summaries.
3. Persist with the CLI (scriptable; no `$EDITOR`):

```bash
ak journal create "<title>" --summary "<one-line summary>" --stdin <<'EOF'
## What happened
...

## Decision
...

## Next steps
...
EOF
```

Optional flags: `--date YYYY-MM-DD`, `--project <registry-name>`.

4. Validate when needed:

```bash
ak journal validate <slug-or-filename-stem>
```

5. AgentWiki publish from this skill is **deferred**. Report `AgentWiki publish skipped` and keep the local file as the source of truth.

6. Browse existing entries with `ak journal list` / `ak journal show <slug>`, or the Journals page in desktop/dashboard.

**Optional:** Invoke the `journal-writer` subagent when emotional honesty and failure archaeology are the point of the entry; still persist through `ak journal create`.

## Naming

Created files use `YYYY-MM-DD-<slug>.md` with `-2`, `-3`, … collision suffixes.

## Workflow Position

**Typically follows:** `/ak:cook` (journal after implementation), `/ak:fix` (journal after bug fix)
**Related:** `the engineer ship skill` (journal after shipping, engineer tier)
**Terminal skill** — no typical successor.

## Journal step — opt-out

## Automatic vs explicit invocation

Explicit `/ak:journal` and `ak journal create` are always available and are
unaffected by any preference or flag.

The **automatic** journal step at the end of the `ak:plan`, `/ak:cook`,
`/ak:fix`, `ak:ship`, and `ak:bootstrap` skills honors:
- The `--skip-journal` flag on the invoking skill.
- The `journal.auto` config preference (default: `true`).
  Set with: `ak config prefs set journal.auto false` (or `true` to re-enable).

Precedence when a workflow decides whether to run the automatic step: flag >
project config > user config > default (`true`). When the automatic step is
skipped, workflows print one line so the intent stays visible in output:
- `journal skipped by --skip-journal` (flag), or
- `journal skipped by preference` (config).

## Configuration

Channels, language, writing style, and AI model defaults resolve from
`.agentkit/journal.yaml` and `.agentkit/config.yaml` / `~/.agentkit/config.yaml`
via `scripts/resolve-config.cjs`:

```bash
node scripts/resolve-config.cjs --json
```

- Full schema + precedence: `references/config-schema.md`
- Secret/env resolution cascade: `references/env-cascade.md`
- Writing-style discovery: `references/writing-styles-resolver.md`
- Channel shape (X, Threads, LinkedIn, Facebook, Bluesky, Mastodon):
  `references/channels-config.md`
- Copyable starter config: `assets/journal.yaml.example`

## Social publishing

**Prerequisites:** `ZERNIO_API_KEY` resolvable via the env cascade (or
`zernio auth:login` already run), and a `.agentkit/journal.yaml` with at
least one channel configured (`references/channels-config.md`).

**Workflow:**

1. Write and persist the journal via `ak journal create` as above.
2. Resolve config + read the discovered writing style (`references/writing-styles-resolver.md`).
3. Draft a per-channel body for each configured channel — the agent handles
   any localization or tone/style adaptation here; the scripts never do.
4. Write the per-channel bodies to a JSON file (`{channel_id: body}`) and
   invoke the posting script:

```bash
node scripts/post-social.cjs \
  --journal-file <path-to-journal.md> \
  --channel-bodies <path-to-channel-bodies.json> \
  --dry-run --json
```

Inspect the `--dry-run` output first — it prints the exact per-channel
`posts:create` argv (including `--threadJson` for long X/Threads bodies,
auto-split ≤ 6 posts) without contacting zernio. Drop `--dry-run` to publish.

5. A summary table prints to stderr; machine-readable results print to
   stdout with `--json`. Successful channels are recorded so a bare re-run
   never double-posts — see `references/zernio-integration.md` for the
   retry contract, rate-limit handling, and the pinned zernio-cli commit.

Full reference: `references/zernio-integration.md`.

## Media

Attach an image and/or video to a `--social` post: `--image <path-or-glob>`
or `--image-ai <prompt>` (AI-generated via multix), and `--video
<path-or-glob>` or `--video-ai <prompt>`. If you want a generated
template/highlight image or video rather than a raw AI prompt, orchestrate
that yourself first — invoke the installed ak-design/ak-frontend-design
skill (image) or the installed ak-hyperframes/ak-remotion skill (video) —
then pass the resulting file through `--image`/`--video`; the router
scripts here are pure path-in/path-out delegators, not generators of their
own templates. Resolved media is uploaded once and attached to every
targeted channel; a channel whose platform rejects the attached media falls
back to a text-only post automatically (`MEDIA_UNSUPPORTED` in the
summary), other channels are unaffected.

Full reference: `references/media-flags.md`.
