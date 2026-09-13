# Bundled skills

Agent skills that ship with RFC Code, so a fresh install has a populated
toolbox instead of an empty `skills/` directory. The server links them into
each account profile's config directory one by one, which is what makes the
per-profile selection in the skills panel possible — see
`server/modules/bundled-skills/`.

145 directories: 106 come from the AgentKit Engineer kit and carry its `ak-`
prefix, and 39 are skills from other sources that the kit does not ship.

## Where they came from

`ak-*` is the Engineer kit of [AgentKit](https://agentkit.best), which absorbed
ClaudeKit — the `ck-` prefixed skills earlier versions of this bundle carried
are the same skills under their new names, and profiles follow the rename
automatically (`repairSkillLinks`).

Everything else was collected from the local `~/.claude*` profile directories:
the gstack family (`ship`, `retro`, `review`, `qa`, `browse`, the `plan-*`
reviews, …) and a handful of specialist skills the kit dropped
(`ai-architect`, `cloud-architect`, `container-specialist`, `dba-specialist`,
`frontend-specialist`, `js-specialist`, `php-specialist`,
`principal-engineer`, `senior-architect`, `pr-feedback`, `tlc-spec-driven`).

`ak-common` is the one entry linked into every profile whether or not it was
asked for: it holds the shared material the rest of the kit loads, and offering
it as a toggle would let someone switch off a dependency and break skills that
look unrelated to it.

## Skills that need a build step

`gstack` and `browse` run from a compiled single-file executable that is **not
committed** — five of them totalled 290 MB, they are built for one platform,
and they would not run inside the Linux container anyway. Their TypeScript
sources are here; build them on the machine that will run them, following each
skill's own instructions.

Until they are built, those two skills are the only ones in this directory that
will not work straight from a clone.

## Refreshing the AgentKit half

The `ak-*` directories are generated, not edited here. Install the CLI, sign in
with an account that has Engineer Kit access, and emit the kit into a scratch
project:

```sh
curl -fsSL https://agentkit.best/install.sh | sh
ak login --api-key ak_live_... --no-interactive
mkdir /tmp/ak && cd /tmp/ak && ak kit init engineer --target claude-code --yes
```

Then replace the `ak-*` directories here with `/tmp/ak/.claude/skills/ak-*`,
and refresh `../agent-kit/` from the rest of that output — see
`../agent-kit/README.md`. The non-`ak-` directories are not part of that
output and must survive the swap; two of them (`retro`, `ship`) share a name
with a kit skill and are the gstack version, not a stale copy.
