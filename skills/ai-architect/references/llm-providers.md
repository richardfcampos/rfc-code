# LLM Providers & Model Selection

## Table of Contents
- [Anthropic (Claude)](#anthropic-claude)
- [OpenAI (GPT)](#openai-gpt)
- [Google (Gemini)](#google-gemini)
- [Open-Source Models](#open-source-models)
- [Provider Comparison](#provider-comparison)
- [Prompt Engineering](#prompt-engineering)

## Anthropic (Claude)

### Model Lineup
| Model | Context | Best For | Pricing (input/output per 1M) |
|-------|---------|----------|-------------------------------|
| Claude Opus 4 | 200K | Complex reasoning, code, research | $15 / $75 |
| Claude Sonnet 4 | 200K | General tasks, tool use, vision | $3 / $15 |
| Claude Haiku 3.5 | 200K | Fast classification, extraction | $0.80 / $4 |

### Key Strengths
- Strongest instruction-following and safety.
- Extended thinking (chain-of-thought before response).
- 200K context window on all models.
- Native tool use with structured outputs.
- Vision (image analysis) on Sonnet/Opus.
- Batch API for 50% cost reduction on async workloads.

### API Pattern
```python
import anthropic

client = anthropic.Anthropic()

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    system="You are a helpful assistant. Always cite sources.",
    messages=[
        {"role": "user", "content": "Explain quantum computing."}
    ],
    # Structured output.
    tools=[{
        "name": "respond",
        "description": "Structured response",
        "input_schema": {
            "type": "object",
            "properties": {
                "answer": {"type": "string"},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "sources": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["answer", "confidence"]
        }
    }]
)
```

### Extended Thinking
```python
# Enable chain-of-thought for complex reasoning.
message = client.messages.create(
    model="claude-opus-4-20250514",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000    # Tokens for internal reasoning.
    },
    messages=[{"role": "user", "content": "Analyze this codebase for security issues..."}]
)
# Access thinking: message.content[0] (thinking block), message.content[1] (response).
```

## OpenAI (GPT)

### Model Lineup
| Model | Context | Best For | Pricing (input/output per 1M) |
|-------|---------|----------|-------------------------------|
| GPT-4o | 128K | General, vision, tool use | $2.50 / $10 |
| GPT-4o-mini | 128K | Fast, cheap, good quality | $0.15 / $0.60 |
| o1 | 200K | Deep reasoning, math, code | $15 / $60 |
| o3-mini | 200K | Reasoning at lower cost | $1.10 / $4.40 |

### Key Strengths
- Largest ecosystem (libraries, tutorials, integrations).
- Function calling with parallel tool use.
- Structured outputs with JSON schema enforcement.
- Assistants API with built-in RAG and code interpreter.
- DALL-E for image generation, Whisper for speech-to-text.
- Fine-tuning on GPT-4o-mini.

### API Pattern
```python
from openai import OpenAI

client = OpenAI()

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain quantum computing."}
    ],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "response",
            "schema": {
                "type": "object",
                "properties": {
                    "answer": {"type": "string"},
                    "confidence": {"type": "number"}
                },
                "required": ["answer", "confidence"]
            }
        }
    }
)
```

## Google (Gemini)

### Model Lineup
| Model | Context | Best For | Pricing (input/output per 1M) |
|-------|---------|----------|-------------------------------|
| Gemini 2.5 Pro | 1M+ | Long context, multimodal | $1.25-2.50 / $10-15 |
| Gemini 2.5 Flash | 1M+ | Fast, cheap, good quality | $0.15 / $0.60 |
| Gemini 2.0 Flash | 1M | Balanced speed/quality | $0.10 / $0.40 |

### Key Strengths
- Largest context window (1M+ tokens).
- Native multimodal (text, image, audio, video).
- Google Search grounding built-in.
- Vertex AI for enterprise deployment.
- Cheapest per-token for high-volume workloads.

## Open-Source Models

### Top Models
| Model | Params | License | Best For |
|-------|--------|---------|----------|
| Llama 3.1 | 8B/70B/405B | Meta Community | General purpose, fine-tuning |
| Mistral Large 2 | 123B | Apache 2.0 | Multilingual, code |
| Mixtral 8x22B | MoE | Apache 2.0 | Efficiency, multi-task |
| Qwen 2.5 | 7B-72B | Apache 2.0 | Multilingual, code |
| DeepSeek V3 | 671B MoE | MIT | Reasoning, code |
| Phi-3 | 3.8B/14B | MIT | Edge, mobile, small |

### Hosting Options
| Platform | Type | Use When |
|----------|------|----------|
| vLLM | Self-hosted | Maximum control, GPU infra |
| Ollama | Local dev | Prototyping, testing |
| Together AI | Serverless | Pay-per-token, no infra |
| Fireworks AI | Serverless | Low latency, function calling |
| AWS Bedrock | Managed | AWS ecosystem, enterprise |
| Azure AI | Managed | Azure ecosystem |

### When Open-Source Over API
- **Data privacy**: No data leaves your infrastructure.
- **Cost at scale**: Cheaper than API at high volume (>$10K/month).
- **Customization**: Fine-tuning with proprietary data.
- **Latency**: Dedicated GPU = predictable latency.
- **Offline**: Edge/air-gapped environments.

## Provider Comparison

| Feature | Anthropic | OpenAI | Google | Open-Source |
|---------|-----------|--------|--------|-------------|
| Reasoning | Excellent | Excellent | Good | Good (large models) |
| Safety | Best | Good | Good | Varies |
| Context window | 200K | 128K-200K | 1M+ | 8K-128K |
| Tool use | Excellent | Excellent | Good | Improving |
| Vision | Yes | Yes | Yes (video too) | Limited |
| Structured output | Tool-based | JSON schema | JSON | Varies |
| Batch API | Yes (50% off) | Yes (50% off) | Yes | N/A |
| Fine-tuning | No | Yes (4o-mini) | Yes | Full control |
| Self-hosting | No | No | No | Yes |
| Data residency | US/EU | US/EU | Global | Your infra |

## Prompt Engineering

### System Prompt Design
```
# Structure for effective system prompts.
1. Role definition — Who the AI is.
2. Task description — What it should do.
3. Constraints — What it must NOT do.
4. Output format — Exact structure expected.
5. Examples — 1-3 demonstrations (few-shot).
6. Safety instructions — Handling edge cases.
```

### Few-Shot Pattern
```python
messages = [
    {"role": "system", "content": "Extract structured data from text."},
    # Example 1.
    {"role": "user", "content": "John Doe, age 30, lives in NYC"},
    {"role": "assistant", "content": '{"name": "John Doe", "age": 30, "city": "NYC"}'},
    # Example 2.
    {"role": "user", "content": "Jane Smith, 25 years old, from London"},
    {"role": "assistant", "content": '{"name": "Jane Smith", "age": 25, "city": "London"}'},
    # Actual query.
    {"role": "user", "content": actual_input}
]
```

### Chain-of-Thought
```python
system = """Think step by step before answering.
1. Identify the key question.
2. List relevant facts.
3. Reason through the answer.
4. State your confidence level (high/medium/low).
5. Provide the final answer."""
```

### Prompt Optimization Tips
| Technique | Effect | When |
|-----------|--------|------|
| Be specific | Higher accuracy | Always |
| Few-shot examples | Format consistency | Structured output |
| Chain-of-thought | Better reasoning | Complex problems |
| Role prompting | Domain expertise | Specialized tasks |
| XML/JSON delimiters | Clearer boundaries | Long prompts |
| Negative instructions | Prevent errors | Known failure modes |
| Temperature 0 | Deterministic | Classification, extraction |
| Temperature 0.7-1 | Creative variety | Writing, brainstorming |
