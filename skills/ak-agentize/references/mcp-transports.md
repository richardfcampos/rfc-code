# MCP Transports

Ship **stdio** (local) and **Streamable HTTP** (remote). Treat SSE as deprecated/legacy during the offramp. One core `Server`, thin transport adapters.

**Sources:** [MCP transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), [2026-07-28 blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

## Transport selection

```ts
const transport = process.env.MCP_TRANSPORT ?? flag("--transport") ?? "stdio";
switch (transport) {
  case "stdio": await startStdio(server); break;
  case "sse": await startSse(server, { port }); break; // legacy only
  case "http": await startStreamableHttp(server, { port }); break;
  default: die(`unknown transport: ${transport}`);
}
```

## stdio

Unchanged. Default for local agents (Claude Code, Cursor, etc.).

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const t = new StdioServerTransport();
await server.connect(t);
```

- No transport-layer OAuth — trust the parent; credentials from env/config
- Never write non-protocol bytes to stdout; logs → stderr

## Streamable HTTP (primary remote)

Preferred remote transport. Single endpoint handles POST (JSON-RPC) and optional GET (stream). Required for Cloudflare Workers and most PaaS.

```ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
app.all("/mcp", async (c) => {
  const t = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(), // omit / undefined for stateless
  });
  await server.connect(t);
  return t.handleRequest(c.req.raw, c.res);
});
```

### Stateless vs stateful modes

| Mode | Behavior | When |
| --- | --- | --- |
| **stateless** | Every request is self-describing; any replica can serve it; no sticky sessions | Serverless, horizontal scale (preferred for new servers) |
| **stateful** | Server issues `Mcp-Session-Id` (or `mcp-session-id`); client echoes it; resumable streams | Per-session memory, Durable Objects, long SSE-like streams |

**stateless (2026-07-28 direction):** Prefer no protocol session. Newer stacks may route with `Mcp-Method` / `Mcp-Name` headers so gateways avoid body inspection. Round-robin LBs work without affinity.

**stateful:** Keep `sessionIdGenerator` and store session keyed by `Mcp-Session-Id`. On Cloudflare Workers use Durable Objects; on Docker/Node use sticky sessions or Redis. Support resumability via last-event / stream cursors when exposing GET streams.

**Sources:** [MCP goes stateless](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [InfoQ](https://infoq.com/news/2026/08/mcp-stateless-gateway/)

## tasks (long-running)

Experimental since **2025-11-25**; still experimental under `io.modelcontextprotocol/tasks` as of **2026-07-28**. Use for work longer than ~30s (ETL, batch export, human-in-the-loop). Short ops stay ordinary tools.

Lifecycle: `working` → optional `input_required` → terminal `completed` | `failed` | `cancelled`.

| Method | Purpose |
| --- | --- |
| `tasks/get` | Poll status / progress |
| `tasks/list` | Active tasks |
| `tasks/update` | Supply input when `input_required` |
| `tasks/cancel` | Graceful cancel |
| `tasks/result` | Final output |

**Sources:** [Tasks utility](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks), [Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview)

## Structured tool output

Return dual content: human `content` summary + machine `structuredContent` validated by an output schema (JSON Schema / Zod). FastMCP / modern SDKs expose `result_type` for typed results.

```ts
server.tool(
  "list_projects",
  "List projects. Concise by default; `format: detailed` for full data.",
  {
    format: z.enum(["concise", "detailed"]).default("concise"),
    limit: z.number().int().min(1).max(100).default(25),
  },
  async (args, ctx) => core.listProjects({ ...args, auth: ctx.auth }),
);
```

Register tools once on the core `Server`; all transports expose the same set.

## SSE (deprecated / legacy)

Deprecated per the [2026-07-28 announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/) with a ~12-month offramp (~through August 2027). Some vendors (e.g. Atlassian) already sunsetting HTTP+SSE. Keep a thin adapter only for old clients; document Streamable HTTP as the migration target.

```ts
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
app.get("/sse", async (c) => {
  const t = new SSEServerTransport("/messages", c.res);
  await server.connect(t);
});
app.post("/messages", (c) => t.handlePostMessage(c.req, c.res));
```

**Sources:** [SSE sunset notes](https://sunny34.com/blog/posts/mcp-sse-transport-sunset-ops.en), [Cloudflare MCP v2](https://blog.cloudflare.com/mcp-v2/)

## Auth (HTTP only)

Prefer OAuth 2.1 for public remote servers — see `oauth-streamable-http.md`. Simple bearer still fine for private tokens:

```
Authorization: Bearer <token>
```

Reject with `401` early. Cloudflare: Workers Secrets; Docker: secret manager → env; never bake into images.

## SDK support tiers (2026-07-28)

| SDK | Tier | Notes |
| --- | --- | --- |
| TypeScript SDK v2 | Tier 1 | `@modelcontextprotocol/server` / `client`; Streamable HTTP, OAuth helpers, tasks |
| Python SDK v2 | Tier 1 | `pip install mcp[cli]`; TokenVerifier / AuthSettings; serverless-friendly |
| v1.x | Security patches only | Do not start new work on v1 |

**Sources:** [TS SDK](https://github.com/modelcontextprotocol/typescript-sdk), [Python SDK](https://github.com/modelcontextprotocol/python-sdk)

## Health & observability

- `GET /healthz` → 200 when up
- `GET /readyz` → 200 when ready
- JSON logs on stderr: `trace_id`, `session_id`, `tool_name`, `duration_ms` — never args/secrets

## Related

- `oauth-streamable-http.md` — OAuth 2.1 + PKCE for Streamable HTTP
- `code-mode.md` — sandboxed code orchestration over MCP tools
- `deployment-guide.md` — Workers / Docker wiring
