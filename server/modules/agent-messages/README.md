# Agent Messages — handoff inbox

Persistent agent↔agent messages. One session hands work to another, the other
acknowledges it and eventually answers; every step is a row in SQLite, so a
handoff in flight survives a server restart with no in-memory state to rebuild.

```
                    ┌──────────────────────────────┐
   message_send ───▶│ modules/agent-messages       │───▶ ws: agent_message_update
                    │ service + state machine      │
   message_list ───▶│                              │───▶ sqlite: agent_messages
   message_ack  ───▶│                              │
   message_answer ─▶└──────────────────────────────┘
                                 ▲
   GET /api/agent-messages ──────┘  (read-only, never delivers)
```

## State machine

```
 queued ──deliver──▶ delivered ──ack──▶ acknowledged ──answer──▶ answered
    │                    │                    │
    │                    └──────answer────────┼──────────────────▶ answered
    │                                         │
    └────fail─────────────fail────────────────┴──────────────────▶ failed
```

| From | May move to |
| --- | --- |
| `queued` | `delivered`, `failed` |
| `delivered` | `acknowledged`, `answered`, `failed` |
| `acknowledged` | `answered`, `failed` |
| `answered` | — terminal |
| `failed` | — terminal |

Three rules explain the shape:

- **`queued → acknowledged` is refused.** A session cannot acknowledge a message
  it never received, so delivery is always observed first.
- **`delivered → answered` is allowed.** Producing an answer is stronger evidence
  of receipt than an ack; demanding the ack first would only add bookkeeping
  that proves less than what the agent just did.
- **`answered` and `failed` are terminal.** A settled handoff is never reopened;
  it is superseded by a new message. Trying anyway is a `409
  AGENT_MESSAGE_INVALID_TRANSITION`, never a silent overwrite.

Every move is a single guarded `UPDATE ... WHERE state IN (...)`, so two agents
racing on the same message produce exactly one winner and one 409.

## Delivery is a pull, not a push

Nothing can inject text into a running agent's context from outside, so this
module does not pretend to. `delivered` means **the recipient session asked for
its own inbox** through `message_list` — that is the only honest delivery
signal available, and it is why `message_list` is a mutating call.

The consequence worth remembering: the REST surface (`GET /api/agent-messages`,
what a human UI reads) never changes a state. Opening the inbox in a browser
cannot forge a delivery on the agent's behalf.

## Authorization

The acting session id always comes from the agent bridge's verified token,
never from the request body:

| Operation | Who may do it |
| --- | --- |
| send | any live session, to any other live session |
| list inbox / ack / answer | the recipient only |
| list outbox | the sender only |
| fail | either participant (sender gives up, recipient refuses the work) |

A message the caller is not a party to answers **404**, not 403, so one session
cannot probe another's mailbox for which message ids exist.

## Failure

`fail` records an optional reason in `detail` (500 chars). It is what a stuck
lead session reads instead of a bare state: "worker never picked it up",
"out of scope for this worktree".

## WebSocket

Every state change broadcasts to all connected chat clients:

```json
{ "kind": "agent_message_update", "action": "created" | "updated", "message": { ... } }
```

`action` is `created` for a new message and `updated` for a state change; which
change it was is readable from `message.state`, so clients get the whole current
row instead of a diff to replay.

## REST

```
GET /api/agent-messages?sessionId=<id>&box=inbox|outbox&state=<state>
→ { success: true, data: { messages: [ ... ] } }
```

Read-only and behind `authenticateToken`. Mutating a handoff is an agent action
and goes through the bridge, where the acting session is proven by its token —
over REST the caller is a *user*, and letting it POST would mean letting it
forge a message from any session.
