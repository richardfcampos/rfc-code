# Common brief for grokbot-mcp workers

Work context (git worktree, never cd elsewhere, never touch other worktrees): `/srv/code/personal/rfc-code-worktrees/wt-mcp-grokbot`
Reports: `plans/261102-1920-mcp-grokbot/reports/` · Plans: `plans/261102-1920-mcp-grokbot/`

## Hard rules
- NO `git stash`, `git checkout`, `git reset`, `git commit`, `git push`, no merges. Only edit files; the orchestrator commits.
- `node_modules` is a symlink to prod-main; never add/remove it, never `npm install`.
- Only create/edit the files your task names. Do not edit `server/index.js` unless your task says so.
- Files ≤ 200 lines (split if needed). TypeScript strict. Imports from other modules ONLY via their barrel `@/modules/<name>/index.js` (eslint-plugin-boundaries). Never import `server/middleware/*`, `server/claude-sdk.js` or other legacy root files from inside `server/modules/` — such things are injected by the composition root.
- Comments explain WHY; no plan/task ids (T1, R3…) in code or file names.
- Tests: `node:test` + `node:assert/strict`, file under `server/modules/grokbot-mcp/tests/<name>.test.ts`, run with
  `npx tsx --tsconfig server/tsconfig.json --test server/modules/grokbot-mcp/tests/<name>.test.ts`
- Gate before reporting: your tests green, `npx tsc --noEmit -p server/tsconfig.json` clean, `npx eslint server/modules/grokbot-mcp` clean.

## Contracts (read first)
- `server/modules/grokbot-mcp/grokbot-mcp.types.ts` — ToolDefinition, ToolContext, RestDispatcher/RestRequest, ChatGateway, ShellRunner.
- `server/modules/grokbot-mcp/tools/tool-helpers.ts` — `tool()`, `schema()`, `S.*`, readers `str/optStr/optBool/optInt/strArray/optObject/pick`, enums `PROVIDERS/MCP_SCOPES/TASK_STAGES`, `PROJECT_ID`, `seg()`.
- `server/modules/grokbot-mcp/grokbot-mcp.jsonrpc.ts` — MCP method handling (done).
- `server/modules/grokbot-mcp/tools/index.ts` — registry; the section files it imports currently are placeholders exporting `[]` (`export const <name>Tools: ToolDefinition[] = []`) — keep the export name.
- `server/modules/grokbot-mcp/tests/support/fake-tool-context.ts` — recording dispatcher + fake chat/shell for mapping tests (`runToolAndCapture`).

## Tool conventions
- Name: `snake_case`, section prefix (`task_create`, `git_status`, …). Description ≥ 20 chars, written for a model: what it does + when to use + key ids.
- `inputSchema` via `schema({...}, [required])`, enums with real values.
- `covers`: every REST route the tool calls, as `METHOD /api/path/:param` using the server's own param names (e.g. `PATCH /api/tasks/:id`, `GET /api/providers/:provider/skills`, `GET /api/git/status`). In-process-only tools use `covers: []`.
- `run(args, ctx)` → `ctx.api.dispatch({ method, path, query?, body?, multipart?, responseType? })` and return its result (the dispatcher already unwraps `{success,data}`). Build paths with `seg()` for client-supplied segments. Query values that the server expects as literal `'true'`/`'false'` are passed as booleans (the dispatcher stringifies).
- `projectId` = project registry id (DB) used by `/api/projects/:projectId`, `/api/git?project=`, `/api/worktrees?project=`, `/api/preview/*/:projectId`, `/api/taskmaster/*/:projectId`. Tasks use `project` = `project_name`.
- Route facts are in `plans/261102-1920-mcp-grokbot/research/rest-catalogue-a-*.md` and `rest-catalogue-b-*.md`; when in doubt, read the actual routes file (named there) — never invent fields.

## Mapping test pattern (one test file per section)
```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { taskTools } from '@/modules/grokbot-mcp/tools/tasks.tools.js';
import { runToolAndCapture } from './support/fake-tool-context.js';

test('task_update sends a PATCH with only the given fields', async () => {
  const { request } = await runToolAndCapture(taskTools, 'task_update', { taskId: 't1', stage: 'done' });
  assert.equal(request?.method, 'PATCH');
  assert.equal(request?.path, '/api/tasks/t1');
  assert.deepEqual(request?.body, { stage: 'done' });
});
```
Cover every tool in the section with at least one assertion on method + path (+ body/query when present), plus one test per tool that has required args showing a `ToolInputError` for a missing/blank required arg where the tool reads it with `str()`.

## Report format (end of your reply)
**Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
**Summary:** 1–2 sentences
**Files changed:** list
**Gate:** tests N/N, tsc clean?, eslint clean?
**Concerns/Blockers:** if any (e.g. a route whose fields you could not confirm)
