# Bundled agent kit

Everything the AgentKit Engineer kit ships apart from its skills, which live in
`../skills/` because they are toggleable one at a time. Claude Code only finds
any of this under the config directory a session runs against, so the server
links it into each account profile — see `server/modules/bundled-kit/`.

| Directory | What it is |
| --- | --- |
| `agents/` | Subagent definitions (`planner`, `code-reviewer`, `tester`, …) |
| `rules/` | Always-loaded workflow and orchestration rules |
| `output-styles/` | The `coding-level` output styles, 0 through 5 |
| `hooks/` | The kit's hook scripts, plus the `lib/` they share |
| `statusline.cjs` | Status line, claimed only when a profile has none |
| `hooks-settings.json` | The kit's own hook wiring, with the install path left as `__HOOKS_DIR__` |

`hooks-settings.json` is what the server registers into a profile's
`settings.json`, with the token replaced by this directory's real path. That
path is also how an entry is recognized as the kit's later, so only the kit's
hooks are ever removed or rewritten and anything else in the file survives.

The hooks keep their per-session state under `AGENTKIT_CLAUDE_HOME`,
`AGENTKIT_HOME` and `CK_HOOK_LOG_DIR`, which the server points at the profile
directory. Without those they write into the invoking user's `~/.claude` and
into this directory — one set of state shared by every account, inside the
app's install rather than its data.

Profiles get the hooks; the CLI's own default config directory does not. On a
native install that directory is the user's real `~/.claude`, and registering
hooks there would make these scripts run in every session they start outside
this app.

## Refreshing

Generated, not edited here. Produce a fresh kit as described in
`../skills/README.md`, then from that scratch project's `.claude/`:

```sh
cp -a agents rules output-styles hooks <checkout>/agent-kit/
cp -a ak-engineer-statusline.cjs <checkout>/agent-kit/statusline.cjs
```

and rebuild `hooks-settings.json` from its `settings.json`, replacing
`${CLAUDE_PROJECT_DIR}/.claude/hooks` with `__HOOKS_DIR__`.
