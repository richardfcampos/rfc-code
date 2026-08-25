# Agent Bridge

Lets an agent running inside a chat session drive its own project's task board,
hand work to another agent, and ask which account profile to use, through MCP.

```
agent process ──stdio──▶ server/agent-bridge-mcp.ts ──HTTP──▶ POST /api/agent-bridge/tools/:toolName
                                (bearer: session token)              │
                                                                     ├─▶ modules/tasks
                                                                     ├─▶ modules/agent-messages (handoff inbox)
                                                                     └─▶ modules/orgs (policy + recommend)
```

## Tools

| Tool | Input | Effect |
| --- | --- | --- |
| `task_create` | `title`, `description?`, `suggested_skill?` | Creates a task with `origin: 'agent'` and the session id as `origin_detail` |
| `task_list` | `stage?` | Lists the session project's tasks |
| `task_update_stage` | `taskId`, `stage` | Moves a task between `backlog`/`in_progress`/`review`/`done` |
| `task_update_description` | `taskId`, `description` | Sets a task's markdown description |
| `task_assign` | `taskId`, `profileId` | Assigns an account profile, refused (403) when org policy denies it |
| `task_evidence_add` | `taskId`, `kind` (`note`\|`link`), `content` | Appends a work-log entry to the task. Attachment upload is out of scope for the bridge — an agent that wants to reference a file logs `kind: 'link'` with the file path as `content` instead |
| `task_decompose` | `parentTaskId`, `subtasks: [{ title, description?, skill?, dependsOn?: number[] }]` | Creates the whole plan under a parent atomically. `dependsOn` holds positions in the same array; out-of-range indices, self-references and cycles are refused, and a rejected plan writes nothing |
| `task_ready_list` | `parentTaskId` | Subtasks that can start now: still in `backlog`, every dependency `done` |
| `task_delegate` | `taskId`, `toSessionId?`, `profileId?` | Assigns the task and queues a handoff describing it. An omitted `profileId` comes from `profile_recommend`'s engine and the choice is logged as evidence; a named one is checked against org policy first. Refused while the task still has unfinished dependencies |
| `message_send` | `toSessionId`, `subject`, `body`, `replyToMessageId?` | Queues a handoff message in another session's inbox |
| `message_list` | `box?` (`inbox`\|`outbox`, default `inbox`), `state?` | Lists the caller's mailbox. **Listing the inbox is the delivery event** — the `queued` messages it returns come back `delivered` |
| `message_ack` | `messageId` | Marks a delivered message `acknowledged`: "I have this, I am working on it" |
| `message_answer` | `messageId`, `body`, `subject?` | Marks the message `answered` and queues a linked reply back to its sender |
| `profile_recommend` | `provider?` | Returns the profile the project should use next, quota aware |

Every tool is scoped by the token: the agent never names a project, and a task
id from another project answers 404. The `message_*` tools take the acting
session from the token too, so an agent cannot post a handoff as somebody else,
nor read or acknowledge a message it is not a party to (those answer 404 rather
than 403, so a mailbox cannot be probed for ids).

`toSessionId` is deliberately *not* restricted to the caller's own project: the
common handoff is a lead session delegating to a worker running in a worktree,
which the project registry sees as a different project. The addressee must be a
session that exists right now — a handoff to a session that is already gone is
refused (`AGENT_MESSAGE_RECIPIENT_UNKNOWN`) instead of queued forever.

See `server/modules/agent-messages/README.md` for the message state machine and
the reasoning behind pull-based delivery.

## Maestro loop

`task_decompose` → `task_ready_list` → `task_delegate` → `message_list` is one
loop, and the three maestro tools exist so a leader session can run it without
holding the plan in its own context: the board *is* the plan, and a leader that
dies mid-flight can be replaced by one that reads the same three answers.

`task_delegate` writes two things on purpose — the assignment and the handoff —
because either alone goes unnoticed: an assignment nobody is told about, or a
message about work that is formally nobody's. It settles the profile before it
writes anything, so a policy refusal leaves the board untouched; if the *message*
fails (a worker that has since died), the assignment stands and delegating the
same task to somebody else is the recovery, with no cleanup first.

## Token

The bearer credential is an HMAC over `{ sessionId, projectPath, projectName }`,
signed with a key derived from the installation secret (labelled derivation, so
it is not interchangeable with a user JWT). It does not expire; instead every
call re-checks that the session still exists — once the session is gone the
token answers `410 AGENT_BRIDGE_SESSION_GONE`.

Mint one for a session (JWT-protected, for the UI):

```
GET /api/agent-bridge/session-token?sessionId=<session id>
→ { success: true, data: { token, projectName, projectPath, mcp: { command, args, env } } }
```

## Registration

The token is per session, so this MCP server cannot be registered once for the
whole installation the way a static-token one can (that is what
`browserUseService.registerAgentMcp()` does for the Browser MCP). Registration
is explicit, using the `mcp` block the endpoint above returns:

```json
{
  "name": "cloudcli-agent-bridge",
  "transport": "stdio",
  "command": "cloudcli",
  "args": ["agent-bridge-mcp"],
  "env": {
    "CLOUDCLI_AGENT_BRIDGE_TOKEN": "<token from /session-token>",
    "CLOUDCLI_AGENT_BRIDGE_API_URL": "http://127.0.0.1:3001/api/agent-bridge"
  }
}
```

Inside a packaged install the command resolves to
`node <install>/server/agent-bridge-mcp.js` instead; the endpoint always returns
the form that works for the running install.

Optional: `CLOUDCLI_AGENT_BRIDGE_API_TIMEOUT_MS` (default 30000).
