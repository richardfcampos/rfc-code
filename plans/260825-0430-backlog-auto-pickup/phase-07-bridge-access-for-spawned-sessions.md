# Phase G — Bridge access for server-spawned sessions

> **This phase exists because of a defect found while planning the reviewer.**
> It is a prerequisite for phase-06 and phase-08, and it repairs a gap in the
> already-deployed phases A–C. Read §The finding before anything else.

## Context Links

- Blocks: [phase-06](phase-06-orchestrator-prompts-and-integration.md) (subtask must call `task_update_stage`), [phase-08](phase-08-first-pass-reviewer-and-merge-gate.md) (reviewer must call `review_comment_add`)
- Bridge: `server/modules/agent-bridge/README.md`
- Spawn path: `server/modules/automations/services/automation-agent-spawn.service.ts`

## Overview

- **Priority:** P0 — everything downstream assumes it
- **Status:** pending
- **Effort:** 4h

## The finding

Every prompt this plan writes tells the agent to call bridge tools —
`task_evidence_add`, `task_update_stage`, and (phase-08) `review_comment_add`.
**A server-spawned session has no bridge tools.**

Traced:

1. `createAutomationSpawnGateway` builds the run's options as
   `{ sessionId, resume, cwd, projectPath, profileId }`
   (`automation-agent-spawn.service.ts:158-164`). No MCP configuration.
2. The Claude runtime takes its MCP servers from `loadMcpConfig(options.cwd)`
   (`claude-sdk.js:584-586`), which reads `~/.claude.json` — the global
   `mcpServers` map (`:490-492`) and `claudeProjects[cwd].mcpServers` (`:496-501`).
3. The bridge's registration is **per session**, because its bearer token is an
   HMAC over `{ sessionId, projectPath, projectName }`. Its own composition root
   says so: *"the token is per session, so this cannot be registered once for the
   whole installation … each session gets its own env block, which the UI (or a
   human, see README) writes into the provider's MCP config"*
   (`agent-bridge.module.ts:113-120`, same text in `README.md` §Registration).
4. Nothing writes it. `CLOUDCLI_AGENT_BRIDGE_TOKEN` appears only in the MCP
   client itself (`server/agent-bridge-mcp.ts:43`), the env-var constant
   (`agent-bridge.module.ts:36`), the README example, and two tests. The only
   producer is `GET /api/agent-bridge/session-token`, mounted for the **UI**
   behind a JWT (`agent-bridge.module.ts:152-160`), and no client calls it —
   `grep` over `src/` finds no consumer.

So a pickup agent is told "log progress with `task_evidence_add`" and has no such
tool. It will improvise: leave the card where it is, or write a file. Phase D's
end-to-end smoke is precisely the step that was never ticked, which is why this
survived to deployment.

There is a precedent for the fix but not for the per-session part:
`browserUseService.registerAgentMcp()` (`browser-use.service.ts:472-487`)
registers a *static-token* server once, for every provider, via
`providerMcpService.addMcpServerToAllProviders`.

## Requirements

**Functional**

- A session created by `createAutomationSpawnGateway` starts with the
  `cloudcli-agent-bridge` stdio server registered, carrying a token minted for
  **that** session.
- A provider with no support for injected MCP config fails loudly at dispatch
  rather than running an agent that cannot reach its tools.
- Nothing is left on disk inside the worktree: no file the agent could commit,
  nothing to clean up when the worktree is removed.
- No change to sessions a human starts (they already have the UI path).

**Non-functional**

- The spawn service stays testable without a real bridge: the registration
  arrives as a port, like every other collaborator.

## Architecture — chosen carrier

Three carriers were considered against "least new machinery":

| Carrier | Cost | Verdict |
| --- | --- | --- |
| **Spawn-option injection** — hand the registration to the runtime in memory | one optional field on the spawn options + one merge in `claude-sdk.js` + one port | **chosen** |
| `.mcp.json` in the worktree (`scope: 'project'`, `claude-mcp.provider.ts:44-48`) | writes a real file into the agent's checkout that it can `git add` and that would then be merged into the base branch at approval | rejected — the token would land in the repository |
| `~/.claude.json` `projects[path].mcpServers` (`scope: 'local'`, `claude-mcp.provider.ts:60-65`) | writes the key `projects`, but the runtime reads `claudeProjects` (`claude-sdk.js:496`) — the two do not meet | rejected — would silently not apply |

The second and third also leak: both persist a session token past the session.

```
pickupTask / integrateParentTask / reviewer dispatch
  └─ spawnGateway.promptAgent(input)          automation-agent-spawn.service.ts:129
       sessionId = randomUUID()
       createSession(...)                     ← the session row must exist first:
                                                the token is minted against it and
                                                every bridge call re-checks it
       registration = deps.bridge.describeRegistrationForSession(sessionId)   ← NEW
       options.mcpServers = { [registration.name]: {
           type: 'stdio', command, args, env } }                              ← NEW
       spawnFn(prompt, options, run.writer)
          └─ claude-sdk.js: sdkOptions.mcpServers = { ...loadMcpConfig(cwd),
                                                      ...options.mcpServers }  ← NEW merge
```

Order is load-bearing: `createSession` already runs before the spawn
(`automation-agent-spawn.service.ts:138-145`), and `resolveSessionScope` answers
from the sessions table, so minting after it is what makes the token resolvable.
A token minted for a session that does not exist yet answers
`410 AGENT_BRIDGE_SESSION_GONE` on first use.

## Related Code Files

**Modify**

| File | Change |
| --- | --- |
| `server/modules/agent-bridge/agent-bridge.module.ts` | export `describeAgentBridgeRegistrationForSession(sessionId)` |
| `server/modules/agent-bridge/index.ts` | re-export it |
| `server/modules/automations/services/automation-agent-spawn.service.ts` | `bridge` port + `options.mcpServers` |
| `server/modules/automations/automations.module.ts` | bind the port |
| `server/claude-sdk.js` | merge `options.mcpServers` over the loaded config |
| `server/modules/automations/tests/automation-agent-spawn.test.ts` | new cases |
| `server/modules/agent-bridge/README.md` | §Registration gains the server-spawned path |

**Create** — nothing.

## Implementation Steps

1. **Export the registration from the bridge.** `describeRegistration` and
   `mintAgentBridgeToken` are already both in scope in `agent-bridge.module.ts`
   (`:121-136`, `:158`), and `resolveSessionScope` is the same lookup the token
   route uses (`:149`):
   ```ts
   /**
    * Registration for a session the server started itself.
    *
    * The UI mints its own through `/session-token`; a server-spawned run has no
    * browser to do that, and handing it the block directly is what keeps the
    * token out of any file.
    */
   export function describeAgentBridgeRegistrationForSession(
     sessionId: string,
   ): AgentBridgeMcpRegistration | null {
     const scope = resolveSessionScope(sessionId);
     if (!scope) return null;
     return describeRegistration(scope, mintAgentBridgeToken(scope));
   }
   ```
   Returns null rather than throwing: a session row that vanished between
   creation and dispatch is the caller's decision to make, not this function's.

2. **Add the port** to `AutomationSpawnDeps` (`automation-agent-spawn.service.ts:58-70`):
   ```ts
   /**
    * The agent's own tool surface. Null when the session cannot be resolved —
    * the run is refused rather than dispatched blind, because every prompt this
    * server writes tells the agent to use tools it would not have.
    */
   bridge: { describeRegistrationForSession(sessionId: string): AgentBridgeMcpRegistrationLike | null };
   ```
   Declare `AgentBridgeMcpRegistrationLike` locally (`name`, `command`, `args`,
   `env`) rather than importing the bridge's type — the module boundary lint
   keeps automations off other modules' internals, and this file imports only
   types today.

3. **Inject at dispatch**, in `promptAgent` after `createSession`
   (`:138-145`) and before `startRun`:
   ```ts
   const registration = deps.bridge.describeRegistrationForSession(sessionId);
   if (!registration) {
     throw new Error(`Could not mint agent-bridge access for session "${sessionId}"`);
   }
   ```
   then in the options object (`:158-164`):
   ```ts
   mcpServers: {
     [registration.name]: {
       type: 'stdio',
       command: registration.command,
       args: registration.args,
       env: registration.env,
     },
   },
   ```
   Throwing is deliberate: it is recorded as a failed attempt and retried by the
   firing service, and — because `pickupTask` reverts the card on a dispatch
   failure (`task-pickup.service.ts:132-141`) — the ticket goes back to the
   backlog rather than sitting in progress with a mute agent.

4. **Bind it** in `automations.module.ts`, next to the existing spawn gateway
   construction (`:52-63`):
   ```ts
   bridge: { describeRegistrationForSession: describeAgentBridgeRegistrationForSession },
   ```

5. **Merge in the runtime.** `claude-sdk.js:584-586` currently does:
   ```js
   const mcpServers = await loadMcpConfig(options.cwd);
   if (mcpServers) { sdkOptions.mcpServers = mcpServers; }
   ```
   Make the caller's servers win, and apply even when the config file has none:
   ```js
   const loaded = await loadMcpConfig(options.cwd);
   const injected = options.mcpServers && typeof options.mcpServers === 'object' ? options.mcpServers : null;
   if (loaded || injected) { sdkOptions.mcpServers = { ...(loaded ?? {}), ...(injected ?? {}) }; }
   ```
   Injected last on purpose: a per-session server must not be shadowed by a
   stale same-named entry in the user's config.

6. **Providers other than Claude.** Only the Claude runtime is changed. Automations
   default to `claude` (`task-pickup.service.ts:18`) but a rule may name another
   provider, so state the limitation in the README and let it be visible: a
   provider whose spawn function ignores `options.mcpServers` produces an agent
   with no tools. Do **not** add a silent capability check — YAGNI until a second
   runtime is wired.

7. **Tests** (`automation-agent-spawn.test.ts`, existing style):
   - the dispatched options carry an `mcpServers` entry named
     `cloudcli-agent-bridge` whose env holds the token the fake bridge minted;
   - the registration is requested **after** the session is created (assert the
     fake bridge saw the same `sessionId` that `createSession` received);
   - a null registration throws, creates no run, and leaves nothing in the registry;
   - an existing test asserting the options shape still passes — the addition is
     additive.
   - `server/claude-sdk.js` has no test harness; cover the merge by asserting the
     options object handed to a fake spawn function, which is where the value is
     actually consumed.

## Todo List

- [ ] `describeAgentBridgeRegistrationForSession` exported from the bridge module + index
- [ ] `bridge` port on `AutomationSpawnDeps`
- [ ] Registration injected into the spawn options, after `createSession`
- [ ] Port bound in `automations.module.ts`
- [ ] `claude-sdk.js` merges `options.mcpServers`
- [ ] Tests: shape, ordering, null-registration refusal
- [ ] Bridge README §Registration documents the server-spawned path
- [ ] Smoke: a picked-up ticket's agent actually calls `task_update_stage`
- [ ] `npm run build:server` && `npm run typecheck` && `npm run lint` && `npm test` clean

## Smoke — the one that proves the deployed feature

1. Auto-pickup on, create a small ticket, wait for the tick.
2. Open the spawned session in the UI. Its tool list must include the
   `cloudcli-agent-bridge` tools.
3. The agent moves the card to `review` **itself** — no human drag. Before this
   phase, this is the step that silently did not happen.
4. `GET /api/agent-bridge/session-token?sessionId=…` for a *different* session
   returns a different token: confirms the token is per session, not shared.
5. Nothing new appears in `git status` inside the worktree — no `.mcp.json`.

## Success Criteria

- A server-spawned agent can call every tool the prompts reference.
- No session token is written to any file.
- A ticket whose bridge access cannot be minted returns to the backlog instead of
  occupying a slot with an agent that cannot report.

## Risk Assessment

| Risk | L×I | Mitigation |
| --- | --- | --- |
| The Claude runtime ignores `sdkOptions.mcpServers` for resumed/pinned runs | Med×High | Smoke step 2 reads the live tool list; if it does not apply, fall back to `scope: 'project'` `.mcp.json` **plus** a `.git/info/exclude` entry, and record the trade-off |
| Token leaks through process env into agent-readable places | Low×High | Same exposure the UI path already has; the token is scoped to one session and dies with it (`410` once the session is gone) |
| Another provider silently has no tools | Med×Med | Documented; the prompt failure is visible in the session transcript. Second runtime is a follow-up, not this phase |
| Existing user MCP config is overwritten | Low×High | The merge is per-run and in memory — no config file is written at all |
| Phase-05 also edits `automations.module.ts` | Med×Low | Different regions (spawn gateway vs the `board` bindings); land this **after** E/F |

## Rollback

Delete the port and the two option lines; the exported bridge helper is inert
without a caller. `claude-sdk.js`'s merge is a superset of today's behaviour and
can stay. No stored state, no schema, nothing to migrate.

## Security Considerations

- The token grants the bridge's tool surface for **one** session, scoped to that
  session's project — the same grant the UI hands out today, minted the same way,
  with the same `410` once the session is gone.
- Keeping it in memory is strictly better than either file-based carrier: nothing
  survives the process, nothing can be committed, nothing needs revoking.
- No new HTTP surface; `/session-token` stays JWT-only.

## Next Steps

Phase-08 depends on this landing: the reviewer's only way to write a review
comment is a bridge tool.

## Unresolved Questions

1. Should human-started sessions get the same automatic injection, retiring the
   copy-paste registration path entirely? Out of scope here; this phase only
   fixes the runs the server starts.
