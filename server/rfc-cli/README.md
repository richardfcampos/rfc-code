# `rfc` — compact CLI over the Grokbot MCP

A thin client for an external agent (or a human on the VPS) that needs a few
hundred bytes about a session instead of polling `session_events` or paging
through `project_list`. Every subcommand is one or two `tools/call` requests
to `POST /api/grokbot-mcp`; no logic lives in the CLI.

## Configuration

| Source | Keys |
| --- | --- |
| Environment | `RFC_URL` (default `http://localhost:7799`), `RFC_API_KEY` |
| File | `~/.rfc-code/rfc-cli.json` → `{"url": "http://localhost:7799", "apiKey": "ck_…"}` (chmod 600); path override with `RFC_CLI_CONFIG` |

Environment wins over the file. Create the key in **Settings > API Tokens**.
The key only ever travels in the `Authorization: Bearer` header; the CLI never
prints it, not even in error messages.

## Subcommands

Add `--json` to any of them for a single-line, compact JSON object.

### `rfc send <sessionId> "<prompt>"` / `rfc send <sessionId> --file <path>`

Calls `session_send` (no wait) then `session_status`. `--file -` reads stdin.

```
$ rfc send 7f1c2e0a "run the tests and fix what fails"
sent 7f1c2e0a seq=0
$ rfc send 7f1c2e0a --file prompt.md --json
{"sessionId":"7f1c2e0a","provider":"claude","started":true,"lastSeq":0}
```

### `rfc status <sessionId>`

Calls `session_summary`. At most 10 lines; `error` only appears when set.

```
$ rfc status 7f1c2e0a
status    idle
project   rfc-code
branch    feat/x
started   2026-11-04T01:10:03.000Z
duration  3m 04s
lastSeq   412
approval  none
```

`--json` is the summary without `response`, `tests` and `git.files`:

```
{"sessionId":"7f1c2e0a","provider":"claude","project":{"id":"proj-1","name":"rfc-code","path":"/srv/code/personal/rfc-code"},"status":"idle","startedAt":"2026-11-04T01:10:03.000Z","finishedAt":"2026-11-04T01:13:07.000Z","durationMs":184000,"lastSeq":412,"pendingApproval":null,"error":null,"git":{"branch":"feat/x","diffStat":"3 files changed, 41 insertions(+), 2 deletions(-)","untracked":1,"lastCommit":{"hash":"8f862e0","message":"fix(taskmaster): seed tasks.json"}}}
```

### `rfc result <sessionId> [--since <seq>]`

Calls `session_summary {sessionId, sinceSeq}`. `--json` prints the full summary.

```
$ rfc result 7f1c2e0a --since 400
idle  rfc-code  duration=3m 04s  lastSeq=412
--- response
Done. I fixed the parser and added two tests.
--- changes
3 files changed, 41 insertions(+), 2 deletions(-)
  server/a.ts
  server/b.ts
  README.md
untracked: 1
--- tests
node:test passed=42 failed=0 total=42
--- commit
8f862e0 fix(taskmaster): seed tasks.json
branch: feat/x
```

The response is already capped at 1500 characters by the server; `…(truncated)`
marks a cut. `--- tests` prints `not detected` when no test run was recognised.

### `rfc sessions [--project <name>]`

Calls `project_list {compact: true, skipSync: true}`, `session_list_running`
and `project_sessions {projectId, limit: 20}` per project. One line per
session, newest first: id, project, state (`running` / `waiting_approval` /
`idle`), last activity, title (40 chars). `--project` is a case-insensitive
substring match on project name or path.

```
$ rfc sessions --project rfc
7f1c2e0a  rfc-code  running  2026-11-04T01:13:07.000Z  Fix the parser and add tests for the ed…
3b9d10c4  rfc-code  idle     2026-11-04T00:50:00.000Z  Refactor
$ rfc sessions --json
[{"sessionId":"7f1c2e0a","project":"rfc-code","projectId":"proj-1","state":"running","lastActivity":"2026-11-04T01:13:07.000Z","title":"Fix the parser and add tests for the ed…","provider":"claude"}]
```

### `rfc notify-test <endpointId>`

Calls `notification_endpoint_test`. Fires a `session.test` webhook through the
real delivery path (signature, retries, delivery log).

```
$ rfc notify-test james
ok=true deliveryId=dlv_01 attempts=1 status=200
$ rfc notify-test james --json
{"success":true,"ok":true,"deliveryId":"dlv_01","attempts":1,"lastStatus":200,"error":null}
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | the tool refused (`isError`), a JSON-RPC error, or the server was unreachable / timed out (30 s) |
| 2 | usage error (bad arguments, unreadable prompt file) or missing/invalid configuration |

Errors go to stderr; stdout only ever carries the result.

## Install on the VPS

The CLI is compiled with the server into `dist-server/server/rfc-cli/rfc-cli.js`
and exposed as the package `bin` `rfc`. For a checkout install use the wrapper
template:

```sh
sed "s#__RFC_CODE_APP_ROOT__#/srv/code/personal/rfc-code-worktrees/prod-main#" \
  install/templates/rfc | sudo tee /usr/local/bin/rfc >/dev/null
sudo chmod +x /usr/local/bin/rfc
```

The wrapper loads `~/.rfc-code/env` (for `RFC_CODE_NODE` / `RFC_CODE_PATH_PREPEND`)
and execs the compiled entrypoint.

## Tests

```sh
npx tsx --tsconfig server/tsconfig.json --test server/rfc-cli/tests/*.test.ts
```

Also part of `npm test`.
