# MCP & Tool Use

## Table of Contents
- [Model Context Protocol (MCP)](#model-context-protocol-mcp)
- [Function Calling / Tool Use](#function-calling--tool-use)
- [MCP Server Development](#mcp-server-development)
- [Tool Design Patterns](#tool-design-patterns)
- [Error Handling & Safety](#error-handling--safety)

## Model Context Protocol (MCP)

### What Is MCP
- Open protocol (by Anthropic) for connecting LLMs to external tools and data sources.
- Client-server architecture: LLM app (client) ↔ MCP server (tools/resources).
- Transport: stdio (local) or SSE/HTTP (remote).
- Capabilities: tools (actions), resources (data), prompts (templates).

### Architecture
```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  LLM App    │────▶│  MCP Client  │────▶│  MCP Server  │
│  (Claude,   │     │  (SDK)       │     │  (your code) │
│   Cursor)   │◀────│              │◀────│              │
└─────────────┘     └──────────────┘     └──────────────┘
                                              │
                                         ┌────┴────┐
                                         │ External │
                                         │ Services │
                                         └─────────┘
```

### MCP vs Direct API Integration
| Feature | MCP | Direct API |
|---------|-----|------------|
| Reusability | One server, many clients | Per-app integration |
| Discovery | Automatic tool listing | Hardcoded |
| Protocol | Standardized | Custom per API |
| Auth | Built-in patterns | Custom |
| Best for | Multi-app tool sharing | Single-app, simple tools |

## Function Calling / Tool Use

### Anthropic Tool Use
```python
import anthropic

client = anthropic.Anthropic()

tools = [
    {
        "name": "get_weather",
        "description": "Get current weather for a location. Use when the user asks about weather conditions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City and state/country, e.g. 'San Francisco, CA'"
                },
                "units": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "Temperature units"
                }
            },
            "required": ["location"]
        }
    }
]

# Step 1: send message with tools.
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    tools=tools,
    messages=[{"role": "user", "content": "What's the weather in Paris?"}]
)

# Step 2: check for tool_use in response.
for block in response.content:
    if block.type == "tool_use":
        tool_name = block.name       # "get_weather"
        tool_input = block.input     # {"location": "Paris, France"}
        tool_use_id = block.id

        # Step 3: execute tool and return result.
        result = execute_tool(tool_name, tool_input)

        # Step 4: send tool result back.
        followup = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            tools=tools,
            messages=[
                {"role": "user", "content": "What's the weather in Paris?"},
                {"role": "assistant", "content": response.content},
                {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": json.dumps(result)
                    }]
                }
            ]
        )
```

### OpenAI Function Calling
```python
from openai import OpenAI

client = OpenAI()

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"},
                    "units": {"type": "string", "enum": ["celsius", "fahrenheit"]}
                },
                "required": ["location"]
            }
        }
    }
]

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Weather in Paris?"}],
    tools=tools,
    tool_choice="auto"   # "auto", "required", or {"type": "function", "function": {"name": "..."}}
)

# Check for tool calls.
if response.choices[0].message.tool_calls:
    for call in response.choices[0].message.tool_calls:
        result = execute_tool(call.function.name, json.loads(call.function.arguments))
        # Send result back with role: "tool".
```

### Key Differences
| Feature | Anthropic | OpenAI |
|---------|-----------|--------|
| Tool definition | `input_schema` | `parameters` |
| Result format | `tool_result` content block | `role: "tool"` message |
| Parallel calls | Sequential by default | Parallel by default |
| Forced tool use | `tool_choice: {"type": "tool", "name": "..."}` | `tool_choice: {"type": "function", "function": {"name": "..."}}` |
| Structured output | Via tool `input_schema` | `response_format` + `json_schema` |

## MCP Server Development

### Python MCP Server (FastMCP)
```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("My Server")

# Define a tool.
@mcp.tool()
def search_database(query: str, limit: int = 10) -> str:
    """Search the database for records matching query.

    Args:
        query: Search query string.
        limit: Maximum results to return.
    """
    results = db.search(query, limit=limit)
    return json.dumps(results)

# Define a resource (read-only data).
@mcp.resource("config://settings")
def get_settings() -> str:
    """Return current application settings."""
    return json.dumps(load_settings())

# Dynamic resource with URI template.
@mcp.resource("users://{user_id}/profile")
def get_user_profile(user_id: str) -> str:
    """Get profile for a specific user."""
    return json.dumps(db.get_user(user_id))

# Define a prompt template.
@mcp.prompt()
def review_code(code: str, language: str = "python") -> str:
    """Generate a code review prompt."""
    return f"Review this {language} code for bugs, security issues, and improvements:\n\n```{language}\n{code}\n```"

# Run server.
if __name__ == "__main__":
    mcp.run()  # stdio transport by default.
```

### TypeScript MCP Server
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "My Server", version: "1.0.0" });

// Define a tool.
server.tool(
  "search_database",
  "Search the database for records.",
  { query: z.string(), limit: z.number().default(10) },
  async ({ query, limit }) => {
    const results = await db.search(query, limit);
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }
);

// Define a resource.
server.resource(
  "settings",
  "config://settings",
  async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(settings), mimeType: "application/json" }]
  })
);

// Run.
const transport = new StdioServerTransport();
await server.connect(transport);
```

### MCP Configuration (Claude Desktop / Claude Code)
```json
{
  "mcpServers": {
    "my-server": {
      "command": "python",
      "args": ["/path/to/server.py"],
      "env": {
        "API_KEY": "..."
      }
    },
    "remote-server": {
      "url": "https://my-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ..."
      }
    }
  }
}
```

## Tool Design Patterns

### Tool Description Best Practices
```python
# Bad: vague description.
{"name": "search", "description": "Search stuff"}

# Good: specific, with usage guidance.
{
    "name": "search_knowledge_base",
    "description": "Search the internal knowledge base for documentation and policies. "
                   "Use when: user asks about company procedures, HR policies, or technical docs. "
                   "Do NOT use for: general web search or external information. "
                   "Returns: list of matching documents with titles, snippets, and relevance scores."
}
```

### Tool Design Checklist
| Principle | Guideline |
|-----------|-----------|
| Single responsibility | One tool = one action. |
| Clear naming | `verb_noun` format (e.g., `search_users`, `create_order`). |
| Minimal parameters | Only require what's needed. Use defaults. |
| Rich descriptions | Describe when to use, when NOT to use, what it returns. |
| Typed inputs | Use JSON Schema with enums, ranges, patterns. |
| Idempotent when possible | Same input → same result (for retries). |
| Bounded output | Limit response size. Paginate large results. |
| Error messages | Return actionable errors, not stack traces. |

### Multi-Tool Orchestration
```python
# Pattern: tool chain (output of one feeds into another).
tools = [
    {"name": "search_products", "description": "Find products by criteria."},
    {"name": "get_product_details", "description": "Get full details for a product ID."},
    {"name": "add_to_cart", "description": "Add a product to the user's cart."},
]
# LLM calls search → gets IDs → calls get_details → calls add_to_cart.

# Pattern: tool routing (LLM picks the right tool).
tools = [
    {"name": "query_sql_database", "description": "For structured data queries."},
    {"name": "search_documents", "description": "For unstructured text search."},
    {"name": "call_external_api", "description": "For real-time external data."},
]
```

## Error Handling & Safety

### Tool Execution Safety
```python
# Always validate tool inputs before execution.
def execute_tool(name: str, inputs: dict) -> dict:
    # 1. Allowlist check.
    if name not in ALLOWED_TOOLS:
        return {"error": f"Unknown tool: {name}"}

    # 2. Input validation (beyond JSON Schema).
    if name == "run_query":
        if any(kw in inputs["query"].upper() for kw in ["DROP", "DELETE", "TRUNCATE"]):
            return {"error": "Destructive queries not allowed."}

    # 3. Rate limiting.
    if not rate_limiter.allow(name):
        return {"error": "Rate limit exceeded. Try again later."}

    # 4. Execute with timeout.
    try:
        result = TOOL_REGISTRY[name](**inputs)
        return {"result": result}
    except TimeoutError:
        return {"error": "Tool execution timed out."}
    except Exception as e:
        logger.error(f"Tool {name} failed: {e}")
        return {"error": "Tool execution failed. Please try again."}
```

### Confirmation Pattern
```python
# For destructive/irreversible actions, require confirmation.
tools = [
    {
        "name": "delete_record",
        "description": "Delete a record. ALWAYS confirm with user before executing. "
                       "First call with dry_run=true to preview, then with dry_run=false to execute.",
        "input_schema": {
            "type": "object",
            "properties": {
                "record_id": {"type": "string"},
                "dry_run": {"type": "boolean", "default": True}
            }
        }
    }
]
```
