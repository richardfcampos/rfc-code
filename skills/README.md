# Bundled skills

Agent skills that ship with RFC Code, so a fresh install has the same toolbox
as the machine this fork is developed on instead of an empty `skills/`
directory.

123 directories: 118 are skills (each with a `SKILL.md`), and five are shared
material the skills load at runtime — `common/` (imported by any skill that
needs an API key), `document-skills/` (the `docx`/`pdf`/`pptx`/`xlsx` family),
`scripts/` and `references/` (used by `skill-creator`), and `ck-help/`.

## Where they came from

Collected from the local `~/.claude*` profile directories. When the same skill
existed in more than one profile with different contents, the version was
picked deliberately rather than by whichever was found first:

| Skill | Taken from | Why |
| --- | --- | --- |
| `skill-creator` | `.claude-pessoal` | Superset — carries `references/output-patterns.md` and `references/workflows.md` that the `.claude` copy keeps in a separate top-level directory |
| `use-mcp` | `.claude` | Superset (adds `scripts/package-lock.json`) |
| `cloud-architect` | `.claude-pessoal` | The `.claude-gdc` copy is nested inside itself (`cloud-architect/cloud-architect/…`) — a broken install, not a newer version |
| `js-specialist` | `.claude-pessoal` | Same nesting defect in `.claude-gdc` |
| `senior-architect` | `.claude-pessoal` | Same nesting defect in `.claude-gdc` |

Everything else resolved in this order: `.claude`, `.claude-pessoal`,
`.claude-gdc`, `.claude-bdc`, `.claude-jet`, `.claude-3`.

## Skills that need a build step

`gstack` and `browse` run from a compiled single-file executable that is **not
committed** — five of them totalled 290 MB, they are built for one platform
(the ones collected here were macOS arm64), and they would not run inside the
Linux container anyway. Their TypeScript sources are here; build them on the
machine that will run them, following each skill's own instructions.

Until they are built, those two skills are the only ones in this directory that
will not work straight from a clone.

## Adding or refreshing skills

Re-scanning the profile directories is what keeps this current — there is no
upstream index to sync against. Skills that arrive bundled with a new Claude
Code or Codex release show up in the profile directories on their own, so a
re-scan picks them up without anyone maintaining a list by hand.
