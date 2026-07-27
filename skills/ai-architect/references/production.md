# Production Deployment

## Table of Contents
- [Architecture & Scaling](#architecture--scaling)
- [Cost Optimization](#cost-optimization)
- [Observability & Monitoring](#observability--monitoring)
- [Evaluation Frameworks](#evaluation-frameworks)
- [Fine-Tuning](#fine-tuning)
- [Deployment Patterns](#deployment-patterns)
- [Operational Runbook](#operational-runbook)

## Architecture & Scaling

### Production Architecture
```
                    ┌─────────────┐
                    │   CDN /     │
                    │  Load Bal.  │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │   API GW    │  Rate limit, auth, routing.
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │ App Server│ │ Cache │ │  Worker   │
        │ (FastAPI) │ │(Redis)│ │ (Celery)  │
        └─────┬─────┘ └───────┘ └─────┬─────┘
              │                        │
        ┌─────┴─────┐           ┌─────┴─────┐
        │  LLM API  │           │ Vector DB │
        │(Anthropic) │           │(Pinecone) │
        └───────────┘           └───────────┘
```

### Scaling Strategies
| Component | Strategy | Implementation |
|-----------|----------|---------------|
| API servers | Horizontal autoscale | K8s HPA on CPU/requests |
| LLM calls | Async queuing | Celery/SQS workers |
| Vector DB | Managed scaling | Pinecone serverless, Weaviate Cloud |
| Cache | Redis Cluster | AWS ElastiCache / Upstash |
| Embedding | Batch processing | Async pipeline, batch API |

### Request Flow
```python
# FastAPI production setup.
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import asyncio

app = FastAPI()

@app.post("/api/chat")
async def chat(request: ChatRequest, background: BackgroundTasks):
    # 1. Validate input.
    sanitized = validate_and_sanitize(request.message)

    # 2. Check cache.
    cached = await redis.get(f"chat:{hash(sanitized)}")
    if cached:
        return {"response": cached, "cached": True}

    # 3. Retrieve context (RAG).
    chunks = await vector_db.search(sanitized, top_k=5)

    # 4. Call LLM (with retry and timeout).
    response = await call_llm_with_retry(
        message=sanitized,
        context=chunks,
        timeout=30
    )

    # 5. Validate output.
    validated = validate_output(response)

    # 6. Cache result.
    await redis.setex(f"chat:{hash(sanitized)}", 300, validated)

    # 7. Log async (don't block response).
    background.add_task(log_interaction, request, validated)

    return {"response": validated, "cached": False}
```

### Retry & Fallback
```python
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((anthropic.RateLimitError, anthropic.InternalServerError))
)
async def call_llm_with_retry(message: str, context: str, timeout: int = 30) -> str:
    try:
        response = await asyncio.wait_for(
            client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2048,
                messages=[{"role": "user", "content": f"Context: {context}\n\n{message}"}]
            ),
            timeout=timeout
        )
        return response.content[0].text
    except asyncio.TimeoutError:
        return "Request timed out. Please try again."
    except anthropic.RateLimitError:
        raise  # Let tenacity retry.
    except Exception as e:
        logger.error(f"LLM call failed: {e}")
        return "I'm having trouble processing your request. Please try again."
```

## Cost Optimization

### Token Cost Reduction
| Technique | Savings | Implementation |
|-----------|---------|---------------|
| Prompt caching | 30-50% | Cache repeated system prompts |
| Batch API | 50% | Async workloads (Anthropic/OpenAI batch) |
| Model routing | 40-70% | Haiku for simple, Sonnet for complex |
| Context pruning | 20-40% | Only send relevant chunks, not all |
| Response caching | 50-90% | Redis cache for repeated questions |
| Shorter prompts | 10-30% | Optimize system prompt length |

### Model Routing
```python
# Route to cheaper model when possible.
def route_model(question: str) -> str:
    # Classify complexity.
    complexity = classify_complexity(question)

    if complexity == "simple":
        return "claude-haiku-4-5-20251001"     # Cheapest.
    elif complexity == "medium":
        return "claude-sonnet-4-20250514"    # Balanced.
    else:
        return "claude-opus-4-20250514"      # Most capable.

def classify_complexity(question: str) -> str:
    # Fast heuristic (no LLM call).
    if len(question.split()) < 20 and "?" in question:
        return "simple"
    if any(kw in question.lower() for kw in ["analyze", "compare", "design", "architect"]):
        return "complex"
    return "medium"
```

### Batch Processing
```python
# Anthropic Batch API (50% discount).
import anthropic

client = anthropic.Anthropic()

# Create batch.
batch = client.batches.create(
    requests=[
        {
            "custom_id": f"req_{i}",
            "params": {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": text}]
            }
        }
        for i, text in enumerate(documents)
    ]
)

# Poll for results (takes minutes to hours).
while batch.processing_status != "ended":
    batch = client.batches.retrieve(batch.id)
    await asyncio.sleep(60)

# Get results.
results = client.batches.results(batch.id)
```

### Cost Tracking
```python
# Track cost per request.
def track_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = {
        "claude-opus-4-20250514": {"input": 15.0, "output": 75.0},
        "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
        "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.0},
    }
    p = pricing[model]
    cost = (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000
    metrics.record("llm_cost", cost, tags={"model": model})
    return cost
```

## Observability & Monitoring

### Key Metrics
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Latency (p50) | < 2s | > 5s |
| Latency (p99) | < 10s | > 30s |
| Error rate | < 1% | > 5% |
| Token usage / hour | Baseline | > 2x baseline |
| Cost / day | Budget | > 120% budget |
| Cache hit ratio | > 70% | < 50% |
| Hallucination rate | < 5% | > 10% |
| User satisfaction | > 4/5 | < 3/5 |

### Logging
```python
import structlog

logger = structlog.get_logger()

async def log_interaction(request, response, metadata):
    logger.info(
        "llm_interaction",
        user_id=request.user_id,
        model=metadata["model"],
        input_tokens=metadata["input_tokens"],
        output_tokens=metadata["output_tokens"],
        latency_ms=metadata["latency_ms"],
        cost_usd=metadata["cost"],
        cached=metadata["cached"],
        confidence=metadata.get("confidence"),
        # Don't log full prompt/response in prod (PII risk).
        prompt_hash=hash(request.message),
        response_length=len(response),
    )
```

### Dashboards
```
Essential LLM Operations Dashboard:
1. Request volume (per minute/hour).
2. Latency distribution (p50, p95, p99).
3. Error rate by type (timeout, rate limit, validation, LLM error).
4. Token usage and cost (per model, per endpoint).
5. Cache hit ratio.
6. Top queries and response patterns.
7. Safety events (injection attempts, content flags).
```

## Evaluation Frameworks

### Evaluation Types
| Type | What It Measures | Method |
|------|-----------------|--------|
| Accuracy | Correctness of facts | Human eval + automated checks |
| Faithfulness | Grounded in sources | NLI model or LLM-as-judge |
| Relevance | Answers the question | LLM-as-judge |
| Harmlessness | No harmful content | Content classifier |
| Coherence | Logical, well-structured | LLM-as-judge |
| Latency | Response time | Automated timing |

### LLM-as-Judge
```python
JUDGE_PROMPT = """Evaluate this response on a scale of 1-5 for each criterion.

Question: {question}
Context: {context}
Response: {response}

Criteria:
1. ACCURACY (1-5): Are the facts correct and supported by the context?
2. COMPLETENESS (1-5): Does it fully answer the question?
3. RELEVANCE (1-5): Is the response focused on the question?
4. CLARITY (1-5): Is it well-organized and easy to understand?

Return JSON: {"accuracy": N, "completeness": N, "relevance": N, "clarity": N, "reasoning": "..."}
"""

def evaluate_response(question: str, context: str, response: str) -> dict:
    # Use a strong model as judge (ideally different from generator).
    evaluation = llm.generate(
        JUDGE_PROMPT.format(question=question, context=context, response=response),
        model="claude-opus-4-20250514",
        temperature=0
    )
    return json.loads(evaluation)
```

### Automated Eval Pipeline
```python
# Run evaluations on a test set.
def run_eval_suite(test_cases: list[dict]) -> dict:
    results = []
    for case in test_cases:
        # Generate response.
        response = generate(case["question"], case["context"])

        # Score.
        scores = evaluate_response(case["question"], case["context"], response)

        # Compare to reference if available.
        if "reference_answer" in case:
            similarity = compute_similarity(response, case["reference_answer"])
            scores["reference_similarity"] = similarity

        results.append(scores)

    # Aggregate.
    return {
        "avg_accuracy": mean([r["accuracy"] for r in results]),
        "avg_completeness": mean([r["completeness"] for r in results]),
        "avg_relevance": mean([r["relevance"] for r in results]),
        "avg_clarity": mean([r["clarity"] for r in results]),
        "pass_rate": sum(1 for r in results if r["accuracy"] >= 4) / len(results),
    }
```

## Fine-Tuning

### When to Fine-Tune
| Scenario | Fine-Tune? | Alternative |
|----------|-----------|-------------|
| Consistent output format | Yes | Structured output / few-shot |
| Domain-specific terminology | Maybe | RAG with domain docs |
| Style/tone adaptation | Yes | System prompt |
| Knowledge injection | No | RAG |
| Cost reduction (replace large model) | Yes | Model routing |
| Classification task | Yes | Few-shot prompting |

### Fine-Tuning Pipeline
```python
# OpenAI fine-tuning (GPT-4o-mini).
from openai import OpenAI

client = OpenAI()

# 1. Prepare training data (JSONL format).
# {"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}

# 2. Upload file.
file = client.files.create(file=open("training.jsonl", "rb"), purpose="fine-tune")

# 3. Create fine-tuning job.
job = client.fine_tuning.jobs.create(
    training_file=file.id,
    model="gpt-4o-mini-2024-07-18",
    hyperparameters={"n_epochs": 3}
)

# 4. Monitor.
while job.status != "succeeded":
    job = client.fine_tuning.jobs.retrieve(job.id)

# 5. Use fine-tuned model.
response = client.chat.completions.create(
    model=job.fine_tuned_model,    # "ft:gpt-4o-mini:org:name:id"
    messages=[...]
)
```

### Training Data Quality
| Criterion | Guideline |
|-----------|-----------|
| Minimum examples | 50-100 (more = better) |
| Diversity | Cover all expected input patterns |
| Quality | Human-reviewed, correct responses |
| Format consistency | Same structure across all examples |
| Balance | Equal representation of categories |
| No contamination | Test set separate from training |

## Deployment Patterns

### Blue-Green Deployment
```
# Two identical environments. Switch traffic instantly.

┌─────────┐       ┌──────────────┐
│  Users  │──────▶│ Load Balancer │
└─────────┘       └──────┬───────┘
                         │
              ┌──────────┼──────────┐
              │                     │
       ┌──────┴──────┐     ┌──────┴──────┐
       │  Blue (v1)  │     │ Green (v2)  │
       │  (current)  │     │  (new)      │
       └─────────────┘     └─────────────┘

# Promote Green → Blue after validation.
```

### Canary / Shadow Deployment
```python
# Route small % of traffic to new model/prompt.
import random

def route_request(request) -> str:
    if random.random() < 0.05:    # 5% canary.
        model = "claude-sonnet-4-20250514"    # New version.
        prompt = PROMPT_V2
    else:
        model = "claude-sonnet-4-20250514"    # Current version.
        prompt = PROMPT_V1

    response = llm.generate(prompt, model=model)

    # Log which version was used for comparison.
    log_experiment(request, response, model=model, prompt_version=prompt.version)
    return response
```

### A/B Testing
```python
# Compare two approaches with statistical significance.
def ab_test(request, user_id: str) -> dict:
    # Deterministic assignment (consistent per user).
    variant = "A" if hash(user_id) % 2 == 0 else "B"

    if variant == "A":
        response = generate_v1(request)
    else:
        response = generate_v2(request)

    # Track metrics per variant.
    metrics.record("response_quality", evaluate(response), tags={"variant": variant})
    metrics.record("latency", response.latency_ms, tags={"variant": variant})

    return {"response": response, "variant": variant}
```

## Operational Runbook

### Common Issues
| Issue | Symptoms | Fix |
|-------|----------|-----|
| Rate limited | 429 errors, slow responses | Implement backoff, request quota increase |
| High latency | p99 > 30s | Check prompt length, add caching, use faster model |
| High cost | Budget exceeded | Model routing, caching, reduce prompt size |
| Quality degradation | Low eval scores | Check prompts, update RAG index, review sources |
| Hallucinations spike | User complaints, low faithfulness | Add verification pass, update grounding |
| Cache stampede | Spike in LLM calls after cache expiry | Probabilistic early refresh, locking |

### Health Check
```python
@app.get("/health")
async def health():
    checks = {
        "llm_api": await check_llm_health(),
        "vector_db": await check_vector_db(),
        "cache": await check_redis(),
        "database": await check_db(),
    }
    all_healthy = all(c["status"] == "ok" for c in checks.values())
    return {"status": "healthy" if all_healthy else "degraded", "checks": checks}
```
