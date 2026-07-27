# Agents & Workflows

## Table of Contents
- [Agent Architecture](#agent-architecture)
- [Single Agent Patterns](#single-agent-patterns)
- [Multi-Agent Systems](#multi-agent-systems)
- [Workflow Orchestration](#workflow-orchestration)
- [Agent Frameworks](#agent-frameworks)
- [Production Agent Patterns](#production-agent-patterns)

## Agent Architecture

### What Is an AI Agent
An AI agent is an LLM that autonomously:
1. **Plans** — decomposes a goal into steps.
2. **Executes** — uses tools to take actions.
3. **Observes** — interprets tool results.
4. **Iterates** — adjusts plan based on observations.

### Agent vs Workflow
| Feature | Agent | Workflow |
|---------|-------|---------|
| Control flow | LLM decides | Predefined |
| Flexibility | High (adapts) | Low (fixed) |
| Predictability | Lower | Higher |
| Debugging | Harder | Easier |
| Cost | Higher (more LLM calls) | Lower |
| Use when | Ambiguous tasks, exploration | Well-defined processes |

### Core Agent Loop
```python
def agent_loop(goal: str, tools: list, max_steps: int = 10) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": goal}
    ]

    for step in range(max_steps):
        response = llm.chat(messages, tools=tools)

        # Check if agent wants to use a tool.
        if response.has_tool_calls:
            for tool_call in response.tool_calls:
                result = execute_tool(tool_call.name, tool_call.inputs)
                messages.append({"role": "tool", "content": result})
        else:
            # Agent is done — return final answer.
            return response.text

    return "Max steps reached without conclusion."
```

## Single Agent Patterns

### ReAct (Reasoning + Acting)
```
# LLM alternates between Thought → Action → Observation.

Thought: I need to find the user's order status. Let me search the database.
Action: search_orders(user_id="123")
Observation: [{"order_id": "456", "status": "shipped", "tracking": "ABC123"}]

Thought: Found the order. It's shipped with tracking ABC123. Let me get delivery estimate.
Action: get_tracking_info(tracking_number="ABC123")
Observation: {"estimated_delivery": "2025-03-15", "current_location": "Chicago, IL"}

Thought: I have all the info. Let me respond to the user.
Answer: Your order #456 is shipped and currently in Chicago, IL. Estimated delivery: March 15.
```

### Plan-and-Execute
```python
# Step 1: LLM creates a plan.
# Step 2: Execute each step (may involve tools or sub-agents).
# Step 3: Re-plan if a step fails.

def plan_and_execute(goal: str) -> str:
    # Plan.
    plan = llm.generate(f"Create a step-by-step plan for: {goal}")

    results = []
    for step in plan.steps:
        try:
            result = execute_step(step)
            results.append(result)
        except Exception as e:
            # Re-plan from current state.
            plan = llm.generate(
                f"Original goal: {goal}\n"
                f"Completed: {results}\n"
                f"Failed step: {step} (error: {e})\n"
                f"Create a revised plan."
            )

    return llm.generate(f"Summarize results for goal '{goal}': {results}")
```

### Tool-Augmented Generation
```python
# Agent with specific tool kit for a domain.
SYSTEM = """You are a data analyst agent. You have access to:
- query_database: run SQL queries on the analytics DB.
- create_chart: generate visualizations.
- export_csv: export results to CSV.

Always:
1. Understand the user's question.
2. Write and execute SQL to get the data.
3. Create a visualization if helpful.
4. Explain the findings in plain language."""
```

## Multi-Agent Systems

### Architectures
```
1. SUPERVISOR: One agent delegates to specialist agents.
   ┌──────────┐
   │Supervisor│──▶ Research Agent
   │  Agent   │──▶ Code Agent
   └──────────┘──▶ Review Agent

2. PEER: Agents collaborate as equals, passing work.
   Agent A ──▶ Agent B ──▶ Agent C
      ▲                       │
      └───────────────────────┘

3. HIERARCHICAL: Nested supervisor-worker trees.
   Manager
   ├── Team Lead A
   │   ├── Worker 1
   │   └── Worker 2
   └── Team Lead B
       ├── Worker 3
       └── Worker 4
```

### Supervisor Pattern
```python
SUPERVISOR_SYSTEM = """You are a project manager. Route tasks to specialists:
- researcher: for gathering information and analysis.
- coder: for writing and debugging code.
- reviewer: for code review and quality checks.

Respond with which agent to delegate to and what task to give them.
When all subtasks are complete, synthesize the final answer."""

def supervisor_loop(goal: str) -> str:
    messages = [{"role": "user", "content": goal}]

    while True:
        decision = supervisor_llm.chat(messages)

        if decision.is_final_answer:
            return decision.text

        # Delegate to specialist.
        agent_name = decision.delegate_to
        agent_task = decision.task

        result = run_specialist(agent_name, agent_task)
        messages.append({"role": "tool", "content": f"{agent_name} result: {result}"})
```

### Agent Communication
```python
# Shared memory / blackboard pattern.
class SharedMemory:
    def __init__(self):
        self.facts = {}        # Key-value facts.
        self.messages = []     # Agent-to-agent messages.
        self.artifacts = {}    # Produced outputs (code, docs).

    def add_fact(self, agent: str, key: str, value: str):
        self.facts[key] = {"value": value, "source": agent}

    def send_message(self, from_agent: str, to_agent: str, content: str):
        self.messages.append({"from": from_agent, "to": to_agent, "content": content})
```

## Workflow Orchestration

### Prompt Chaining
```python
# Sequential: output of one LLM call feeds into the next.

# Step 1: extract key topics.
topics = llm.generate("Extract key topics from this article: {article}")

# Step 2: research each topic.
research = llm.generate(f"Research these topics in depth: {topics}")

# Step 3: write summary.
summary = llm.generate(f"Write a summary based on: {research}")

# Gate: only proceed if quality check passes.
quality = llm.generate(f"Rate this summary 1-10: {summary}")
if int(quality) < 7:
    summary = llm.generate(f"Improve this summary: {summary}\nIssues: {quality}")
```

### Parallel Fan-Out / Fan-In
```python
import asyncio

async def parallel_analysis(document: str) -> dict:
    # Fan-out: run analyses in parallel.
    tasks = [
        llm.agenerate(f"Extract key entities from: {document}"),
        llm.agenerate(f"Summarize the sentiment of: {document}"),
        llm.agenerate(f"Identify action items in: {document}"),
    ]
    entities, sentiment, actions = await asyncio.gather(*tasks)

    # Fan-in: combine results.
    combined = llm.generate(
        f"Combine these analyses into a report:\n"
        f"Entities: {entities}\nSentiment: {sentiment}\nActions: {actions}"
    )
    return combined
```

### Router Pattern
```python
# Route to specialized handlers based on intent.
def route_request(user_input: str) -> str:
    # Classify intent.
    intent = llm.generate(
        f"Classify this request into one of: [billing, technical, general, escalate]\n"
        f"Request: {user_input}\nCategory:"
    )

    handlers = {
        "billing": billing_agent,
        "technical": technical_agent,
        "general": general_agent,
        "escalate": human_handoff,
    }

    handler = handlers.get(intent.strip(), general_agent)
    return handler(user_input)
```

### Human-in-the-Loop
```python
# Break agent loop for human review at critical points.
def agent_with_approval(goal: str) -> str:
    plan = llm.generate(f"Create a plan for: {goal}")

    # Checkpoint: human reviews plan.
    approved_plan = request_human_approval(plan)
    if not approved_plan:
        return "Plan rejected by human reviewer."

    for step in approved_plan.steps:
        result = execute_step(step)

        # Checkpoint: human reviews high-risk actions.
        if step.is_high_risk:
            approved = request_human_approval(
                f"Agent wants to: {step}\nResult preview: {result}"
            )
            if not approved:
                continue  # Skip this step.

    return compile_results()
```

## Agent Frameworks

### Framework Comparison
| Framework | Language | Best For | Complexity |
|-----------|----------|----------|------------|
| Claude Agent SDK | Python | Claude-native agents, tool use | Low-Medium |
| LangGraph | Python | Stateful, multi-step workflows | Medium-High |
| CrewAI | Python | Multi-agent teams, role-based | Medium |
| AutoGen | Python | Conversational multi-agent | Medium |
| Semantic Kernel | C# / Python | Enterprise, Microsoft ecosystem | Medium |
| Haystack | Python | RAG-focused pipelines | Medium |

### Claude Agent SDK
```python
import anthropic

# Simple agent with tools.
client = anthropic.Anthropic()

tools = [
    {"name": "search", "description": "Search knowledge base.", "input_schema": {...}},
    {"name": "calculate", "description": "Perform calculations.", "input_schema": {...}},
]

# The SDK handles the tool-use loop automatically.
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    system="You are a helpful research agent. Use tools to find and verify information.",
    tools=tools,
    messages=[{"role": "user", "content": "What's the population of Tokyo?"}]
)
```

### LangGraph (Stateful Workflows)
```python
from langgraph.graph import StateGraph, END

# Define state schema.
class AgentState(TypedDict):
    messages: list
    next_step: str

# Define nodes (each is a function).
def research(state):
    # ... do research.
    return {"messages": state["messages"] + [result], "next_step": "analyze"}

def analyze(state):
    # ... analyze findings.
    return {"messages": state["messages"] + [analysis], "next_step": "report"}

def report(state):
    # ... generate report.
    return {"messages": state["messages"] + [report]}

# Build graph.
workflow = StateGraph(AgentState)
workflow.add_node("research", research)
workflow.add_node("analyze", analyze)
workflow.add_node("report", report)

workflow.add_edge("research", "analyze")
workflow.add_edge("analyze", "report")
workflow.add_edge("report", END)

workflow.set_entry_point("research")
app = workflow.compile()

# Run.
result = app.invoke({"messages": ["Research AI trends"], "next_step": "research"})
```

## Production Agent Patterns

### Guardrails for Agents
```python
# 1. Step limit — prevent infinite loops.
MAX_STEPS = 15

# 2. Cost budget — cap spending.
MAX_TOKENS = 100_000

# 3. Action allowlist — limit what agent can do.
ALLOWED_ACTIONS = {"search", "read_file", "calculate"}
BLOCKED_ACTIONS = {"delete_file", "send_email", "execute_code"}

# 4. Output validation — check agent responses.
def validate_output(output: str) -> bool:
    # No PII in output.
    if contains_pii(output):
        return False
    # No harmful content.
    if content_filter(output):
        return False
    return True
```

### State Management
```python
# Persist agent state for long-running tasks.
class AgentCheckpoint:
    def save(self, agent_id: str, state: dict):
        redis.set(f"agent:{agent_id}:state", json.dumps(state))

    def load(self, agent_id: str) -> dict:
        data = redis.get(f"agent:{agent_id}:state")
        return json.loads(data) if data else None

    def save_step(self, agent_id: str, step: int, result: dict):
        redis.hset(f"agent:{agent_id}:steps", step, json.dumps(result))
```

### Observability
```
# Log every agent step for debugging and evaluation.
{
    "agent_id": "abc123",
    "step": 3,
    "action": "search_database",
    "input": {"query": "revenue Q4"},
    "output": {"results": [...]},
    "tokens_used": 1500,
    "latency_ms": 230,
    "timestamp": "2025-03-15T10:30:00Z"
}

# Track: success rate, avg steps to completion, cost per task, error types.
```
