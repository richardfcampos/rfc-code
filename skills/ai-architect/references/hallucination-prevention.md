# Hallucination Prevention

## Table of Contents
- [Understanding Hallucinations](#understanding-hallucinations)
- [Grounding Techniques](#grounding-techniques)
- [Citation & Attribution](#citation--attribution)
- [Confidence Scoring](#confidence-scoring)
- [Verification Pipelines](#verification-pipelines)
- [Human-in-the-Loop](#human-in-the-loop)

## Understanding Hallucinations

### Types of Hallucinations
| Type | Description | Example | Risk Level |
|------|-------------|---------|------------|
| Factual | Incorrect facts stated confidently | "Python was created in 1985" | High |
| Fabrication | Invented sources, quotes, data | "According to Smith et al. (2023)..." | Critical |
| Logical | Flawed reasoning or math | Incorrect calculation presented as correct | High |
| Attribution | Correct fact, wrong source | Right stat, wrong study | Medium |
| Temporal | Outdated information stated as current | "The current CEO is..." (former CEO) | Medium |
| Conflation | Mixing details from different entities | Combining two people's biographies | High |

### Root Causes
- Training data cutoff (no knowledge of recent events).
- Statistical pattern completion (plausible-sounding but wrong).
- Lack of grounding (no access to source data).
- Pressure to be helpful (generates an answer rather than saying "I don't know").
- Long context degradation (accuracy drops with more context).

## Grounding Techniques

### RAG Grounding (Primary Defense)
```python
# Ground LLM responses in retrieved documents.
GROUNDED_SYSTEM = """Answer the question based ONLY on the provided context.

Rules:
1. Only use information from the context below.
2. If the context doesn't contain the answer, say "I don't have enough information to answer this."
3. Never make up or infer information not in the context.
4. Quote relevant passages when possible.
5. If the context is ambiguous, acknowledge the ambiguity.

Context:
{retrieved_chunks}
"""

def grounded_response(question: str, retriever) -> str:
    chunks = retriever.search(question, top_k=5)

    # Check if retrieved content is relevant enough.
    if not chunks or all(c.score < 0.5 for c in chunks):
        return "I don't have enough information in my knowledge base to answer this question."

    context = "\n\n".join([f"[Source {i+1}]: {c.text}" for i, c in enumerate(chunks)])
    return llm.generate(GROUNDED_SYSTEM.format(retrieved_chunks=context) + f"\n\nQuestion: {question}")
```

### Closed-Book Detection
```python
# Detect when LLM is generating from training data vs provided context.
VERIFICATION_PROMPT = """Given this context and answer, determine if the answer is:
1. GROUNDED — fully supported by the context.
2. PARTIALLY_GROUNDED — some claims supported, some not.
3. UNGROUNDED — not supported by the context at all.

Context: {context}
Answer: {answer}

For each claim in the answer, cite the supporting passage or mark as [UNSUPPORTED].

Verdict:"""

def verify_grounding(context: str, answer: str) -> dict:
    result = llm.generate(VERIFICATION_PROMPT.format(context=context, answer=answer))
    return parse_verification(result)
```

### Tool-Based Grounding
```python
# Use tools to verify facts in real-time.
tools = [
    {"name": "search_web", "description": "Search the web for current information."},
    {"name": "query_database", "description": "Query internal database for facts."},
    {"name": "check_calculation", "description": "Verify mathematical calculations."},
]

FACT_CHECK_SYSTEM = """Before providing your final answer:
1. Use search_web or query_database to verify key facts.
2. Use check_calculation for any numbers or statistics.
3. Only include verified information in your response.
4. Mark any unverified claims with [UNVERIFIED]."""
```

## Citation & Attribution

### Inline Citation Pattern
```python
CITATION_SYSTEM = """Answer with inline citations. Format: [Source N] after each claim.

Rules:
- Every factual claim must have a citation.
- Use [Source N] matching the source numbers in context.
- If you can't cite a claim, don't include it.
- At the end, list all sources used.

Context:
[Source 1]: {chunk_1}
[Source 2]: {chunk_2}
[Source 3]: {chunk_3}
"""

# Example output:
# "The revenue grew 15% year-over-year [Source 1], driven primarily
#  by the enterprise segment [Source 2]. The company reported 50,000
#  new customers [Source 1]."
```

### Citation Verification
```python
def verify_citations(answer: str, sources: dict) -> dict:
    """Check that cited sources actually support the claims."""
    citations = re.findall(r'\[Source (\d+)\]', answer)
    claims = split_into_claims(answer)

    verification = []
    for claim in claims:
        cited_sources = re.findall(r'\[Source (\d+)\]', claim.text)
        for source_id in cited_sources:
            source_text = sources.get(int(source_id), "")
            # Use LLM to verify claim against source.
            is_supported = llm.generate(
                f"Does this source support this claim?\n"
                f"Claim: {claim.text}\n"
                f"Source: {source_text}\n"
                f"Answer YES or NO with explanation."
            )
            verification.append({
                "claim": claim.text,
                "source_id": source_id,
                "supported": "YES" in is_supported.upper(),
                "explanation": is_supported
            })

    return verification
```

## Confidence Scoring

### Self-Reported Confidence
```python
CONFIDENCE_SYSTEM = """After answering, rate your confidence:

Confidence scale:
- HIGH (0.9-1.0): Answer is directly stated in the sources.
- MEDIUM (0.6-0.8): Answer is strongly implied by the sources.
- LOW (0.3-0.5): Answer requires inference beyond the sources.
- VERY_LOW (0.0-0.2): Answer is speculative, sources are insufficient.

Respond in JSON:
{"answer": "...", "confidence": 0.X, "reasoning": "Why this confidence level"}
"""

def confident_response(question: str, context: str) -> dict:
    response = llm.generate(
        CONFIDENCE_SYSTEM + f"\n\nContext: {context}\nQuestion: {question}",
        temperature=0
    )
    result = json.loads(response)

    # Policy: only show answers with sufficient confidence.
    if result["confidence"] < 0.5:
        result["answer"] = (
            f"I'm not confident enough to answer this definitively. "
            f"Here's what I found: {result['answer']}\n\n"
            f"Note: {result['reasoning']}"
        )

    return result
```

### Calibrated Confidence (Multi-Sample)
```python
# Generate multiple responses and measure consistency.
def calibrated_confidence(question: str, context: str, n_samples: int = 5) -> dict:
    responses = []
    for _ in range(n_samples):
        r = llm.generate(
            f"Context: {context}\nQuestion: {question}",
            temperature=0.7    # Add variation.
        )
        responses.append(r)

    # Check consistency.
    consistency_check = llm.generate(
        f"Are these {n_samples} responses consistent with each other?\n"
        f"Responses: {responses}\n"
        f"Return: agreement_score (0-1), consensus_answer, disagreements",
        temperature=0
    )

    result = json.loads(consistency_check)

    # High agreement = high confidence. Low agreement = likely hallucination.
    return {
        "answer": result["consensus_answer"],
        "confidence": result["agreement_score"],
        "disagreements": result["disagreements"]
    }
```

## Verification Pipelines

### Two-Pass Verification
```python
# Pass 1: Generate answer.
# Pass 2: Separate LLM call to verify the answer.

def verified_answer(question: str, context: str) -> dict:
    # Pass 1: Generate.
    answer = llm.generate(f"Context: {context}\nQuestion: {question}")

    # Pass 2: Verify (different prompt, ideally different model).
    verification = llm.generate(
        f"Verify this answer against the provided context.\n\n"
        f"Context: {context}\n"
        f"Question: {question}\n"
        f"Answer to verify: {answer}\n\n"
        f"For each claim in the answer:\n"
        f"1. Is it supported by the context? (YES/NO)\n"
        f"2. If NO, what's wrong?\n"
        f"3. Overall accuracy score (0-100).\n"
        f"Return JSON.",
        temperature=0
    )

    result = json.loads(verification)
    if result["accuracy_score"] < 70:
        # Regenerate with corrections.
        answer = llm.generate(
            f"Context: {context}\n"
            f"Question: {question}\n"
            f"Previous answer had errors: {result['errors']}\n"
            f"Generate a corrected answer."
        )

    return {"answer": answer, "verification": result}
```

### Chain-of-Verification (CoVe)
```
1. LLM generates initial response.
2. LLM generates verification questions about its own claims.
3. LLM answers verification questions independently (without seeing original response).
4. LLM revises original response based on verification answers.

Example:
  Response: "The Eiffel Tower is 330m tall, built in 1889 by Gustav Eiffel."
  Verification Qs: "How tall is the Eiffel Tower?" "When was it built?" "Who built it?"
  Verification As: "330m" "1889" "Gustave Eiffel" (note: Gustav → Gustave)
  Revised: "The Eiffel Tower is 330m tall, built in 1889 by Gustave Eiffel."
```

### Fact-Extraction Pipeline
```python
# Extract factual claims → verify each → compile verified answer.

def extract_and_verify(answer: str, context: str) -> dict:
    # Step 1: extract atomic claims.
    claims = llm.generate(
        f"Extract every factual claim from this text as a JSON list:\n{answer}"
    )

    # Step 2: verify each claim.
    verified_claims = []
    for claim in json.loads(claims):
        verdict = llm.generate(
            f"Is this claim supported by the context?\n"
            f"Claim: {claim}\n"
            f"Context: {context}\n"
            f"Answer: SUPPORTED, CONTRADICTED, or NOT_ENOUGH_INFO"
        )
        verified_claims.append({"claim": claim, "verdict": verdict.strip()})

    # Step 3: rebuild answer with only verified claims.
    supported = [c["claim"] for c in verified_claims if c["verdict"] == "SUPPORTED"]
    unsupported = [c for c in verified_claims if c["verdict"] != "SUPPORTED"]

    return {
        "verified_answer": " ".join(supported),
        "removed_claims": unsupported,
        "verification_rate": len(supported) / len(verified_claims)
    }
```

## Human-in-the-Loop

### When to Escalate
| Condition | Action |
|-----------|--------|
| Confidence < 50% | Flag for human review. |
| Contradictory sources | Present both views, let human decide. |
| High-stakes domain (medical, legal, financial) | Always require human approval. |
| No relevant sources found | Admit uncertainty, suggest human expert. |
| Safety classifier triggered | Block and escalate. |

### Escalation Pattern
```python
def smart_response(question: str, context: str) -> dict:
    answer = generate_with_confidence(question, context)

    if answer["confidence"] >= 0.8:
        return {"response": answer["text"], "needs_review": False}

    if answer["confidence"] >= 0.5:
        return {
            "response": f"{answer['text']}\n\n⚠️ This answer has moderate confidence. "
                        f"Please verify before acting on it.",
            "needs_review": True,
            "review_reason": "moderate_confidence"
        }

    return {
        "response": "I'm not confident enough to provide a reliable answer. "
                    "This has been escalated to a human expert.",
        "needs_review": True,
        "review_reason": "low_confidence",
        "raw_answer": answer["text"]    # For human reviewer.
    }
```

### Feedback Loop
```
User question → LLM answer → Human review → Feedback stored
                                                    │
                                              ┌─────┴─────┐
                                              │ Correct?   │
                                              │ YES → log  │
                                              │ NO  → fix  │
                                              │   + retrain│
                                              └───────────┘
```
