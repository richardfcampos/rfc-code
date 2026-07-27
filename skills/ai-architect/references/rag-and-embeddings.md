# RAG & Embeddings

## Table of Contents
- [RAG Architecture](#rag-architecture)
- [Embedding Models](#embedding-models)
- [Vector Databases](#vector-databases)
- [Chunking Strategies](#chunking-strategies)
- [Retrieval Techniques](#retrieval-techniques)
- [Advanced RAG Patterns](#advanced-rag-patterns)

## RAG Architecture

### Basic RAG Pipeline
```
Ingestion:
  Documents → Chunking → Embedding → Vector DB (store)

Query:
  User Query → Embedding → Vector Search → Top-K Chunks → LLM (generate answer)
```

### When to Use RAG
| Scenario | Use RAG | Alternative |
|----------|---------|-------------|
| Private/proprietary data | Yes | Fine-tuning (if format, not knowledge) |
| Frequently changing data | Yes | Re-fine-tuning too expensive |
| Need citations/sources | Yes | RAG provides source attribution |
| Domain-specific knowledge | Yes | Fine-tuning for style adaptation |
| Simple classification | No | Direct prompting or fine-tuning |
| Creative writing | No | Direct prompting |
| Code generation | Maybe | RAG for API docs, direct for patterns |

### RAG vs Fine-Tuning vs Long Context
| Approach | Knowledge | Cost | Freshness | Accuracy |
|----------|-----------|------|-----------|----------|
| RAG | External retrieval | Medium (vector DB) | Real-time | High (grounded) |
| Fine-tuning | Baked into weights | High (training) | Stale | Medium |
| Long context | In-context window | High (per-request tokens) | Real-time | High |
| RAG + Long context | Best of both | Highest | Real-time | Highest |

## Embedding Models

### Model Comparison
| Model | Dimensions | Max Tokens | MTEB Score | Pricing (per 1M tokens) |
|-------|-----------|------------|------------|------------------------|
| Voyage 3 | 1024 | 32K | Top tier | $0.06 |
| Voyage 3 Lite | 512 | 32K | Good | $0.02 |
| OpenAI text-embedding-3-large | 3072 | 8K | Very good | $0.13 |
| OpenAI text-embedding-3-small | 1536 | 8K | Good | $0.02 |
| Cohere embed-v3 | 1024 | 512 | Very good | $0.10 |
| BGE-M3 (open-source) | 1024 | 8K | Very good | Free (self-host) |
| E5-Mistral-7B (open-source) | 4096 | 32K | Top tier | Free (self-host) |

### Embedding Best Practices
```python
# 1. Use the SAME model for indexing and querying.
# 2. Normalize embeddings for cosine similarity.

import voyageai

vo = voyageai.Client()

# Embedding documents (use input_type for better results).
doc_embeddings = vo.embed(
    texts=["Document text here..."],
    model="voyage-3",
    input_type="document"    # "document" for indexing, "query" for search.
).embeddings

# Embedding queries.
query_embedding = vo.embed(
    texts=["user question"],
    model="voyage-3",
    input_type="query"
).embeddings[0]

# OpenAI embeddings.
from openai import OpenAI
client = OpenAI()

response = client.embeddings.create(
    model="text-embedding-3-small",
    input="Document text here...",
    dimensions=512    # Optional: reduce dimensions for efficiency.
)
embedding = response.data[0].embedding
```

## Vector Databases

### Comparison
| Database | Type | Scaling | Best For |
|----------|------|---------|----------|
| Pinecone | Managed SaaS | Serverless | Quick start, managed |
| Weaviate | Open-source + Cloud | Horizontal | Multi-modal, hybrid search |
| Qdrant | Open-source + Cloud | Horizontal | Filtering, performance |
| Chroma | Open-source | Single node | Prototyping, small scale |
| pgvector | PostgreSQL extension | Vertical | Already using Postgres |
| Milvus | Open-source | Horizontal | Large scale, GPU |
| Elasticsearch | Search engine | Horizontal | Existing ES infrastructure |

### pgvector (PostgreSQL)
```sql
-- Setup.
CREATE EXTENSION vector;

CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB,
    embedding vector(1536)    -- Dimension matches model.
);

-- Create index (IVFFlat for speed, HNSW for accuracy).
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Search.
SELECT id, content, 1 - (embedding <=> $1::vector) AS similarity
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT 10;

-- Filtered search (metadata + vector).
SELECT id, content
FROM documents
WHERE metadata->>'category' = 'technical'
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

### Pinecone
```python
from pinecone import Pinecone

pc = Pinecone(api_key="...")
index = pc.Index("my-index")

# Upsert vectors.
index.upsert(vectors=[
    {"id": "doc1", "values": embedding, "metadata": {"source": "manual", "category": "api"}},
])

# Query with metadata filtering.
results = index.query(
    vector=query_embedding,
    top_k=10,
    filter={"category": {"$eq": "api"}},
    include_metadata=True
)
```

## Chunking Strategies

### Strategy Comparison
| Strategy | Quality | Speed | Use When |
|----------|---------|-------|----------|
| Fixed-size (token count) | Low | Fast | Uniform documents, quick start |
| Sentence splitting | Medium | Fast | Articles, documentation |
| Recursive character | Medium | Fast | General purpose (LangChain default) |
| Semantic chunking | High | Slow | High-quality retrieval needed |
| Document structure | High | Medium | Markdown, HTML, code |
| Agentic chunking | Highest | Slowest | Critical accuracy requirements |

### Implementation Patterns
```python
# 1. Fixed-size with overlap.
def chunk_fixed(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
    return chunks

# 2. Recursive character (LangChain).
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""]    # Try separators in order.
)
chunks = splitter.split_text(document)

# 3. Semantic chunking (group by similarity).
from langchain_experimental.text_splitter import SemanticChunker

splitter = SemanticChunker(
    embeddings=embedding_model,
    breakpoint_threshold_type="percentile",
    breakpoint_threshold_amount=95
)
chunks = splitter.split_text(document)

# 4. Document-structure-aware (Markdown).
from langchain.text_splitter import MarkdownHeaderTextSplitter

headers = [("#", "h1"), ("##", "h2"), ("###", "h3")]
splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers)
chunks = splitter.split_text(markdown_doc)
```

### Chunk Size Guidelines
| Content Type | Chunk Size | Overlap | Rationale |
|-------------|-----------|---------|-----------|
| Technical docs | 500-1000 tokens | 10-20% | Preserve code blocks, concepts |
| Legal/contracts | 300-500 tokens | 20-30% | Precise clause retrieval |
| Conversational | 200-400 tokens | 10% | Short, focused exchanges |
| Code | By function/class | Minimal | Semantic boundaries |
| Tables/structured | By row/section | None | Preserve structure |

## Retrieval Techniques

### Hybrid Search (Vector + Keyword)
```python
# Combine semantic similarity with BM25 keyword matching.
# Score = alpha * vector_score + (1 - alpha) * bm25_score.

# Weaviate hybrid search.
results = client.query.get("Document", ["content", "title"]) \
    .with_hybrid(query="machine learning optimization", alpha=0.7) \
    .with_limit(10) \
    .do()

# Manual hybrid (pgvector + tsvector).
"""
SELECT id, content,
    (0.7 * (1 - (embedding <=> $1::vector))) +
    (0.3 * ts_rank(search_vector, plainto_tsquery($2))) AS score
FROM documents
WHERE search_vector @@ plainto_tsquery($2)
    OR (embedding <=> $1::vector) < 0.5
ORDER BY score DESC
LIMIT 10;
"""
```

### Re-Ranking
```python
# Step 1: retrieve top-50 with vector search (fast, approximate).
# Step 2: re-rank top-50 with cross-encoder (slow, precise).

import cohere

co = cohere.Client("...")

# Initial retrieval.
candidates = vector_db.search(query_embedding, top_k=50)

# Re-rank with cross-encoder.
reranked = co.rerank(
    query="How to optimize database queries?",
    documents=[c.text for c in candidates],
    model="rerank-v3.5",
    top_n=10
)
# Use reranked.results for final context.
```

### Multi-Query Retrieval
```python
# Generate multiple query variations for better recall.
def multi_query_retrieve(question: str, retriever, llm) -> list:
    # LLM generates query variations.
    prompt = f"""Generate 3 different search queries to find information for: {question}
    Return one query per line."""

    variations = llm.generate(prompt).split("\n")

    # Retrieve for each variation.
    all_results = set()
    for query in [question] + variations:
        results = retriever.search(query, top_k=5)
        all_results.update(results)

    return list(all_results)
```

## Advanced RAG Patterns

### Parent-Child Retrieval
```
# Index small chunks (children) for precise matching.
# Return larger chunks (parents) for complete context.

Document → Large Chunk (parent, 2000 tokens)
              ├── Small Chunk 1 (child, 200 tokens) ← search matches this
              ├── Small Chunk 2 (child, 200 tokens)
              └── Small Chunk 3 (child, 200 tokens)

# On match: return parent chunk to LLM for full context.
```

### Contextual Retrieval (Anthropic)
```python
# Add context to each chunk before embedding.
# LLM summarizes the chunk's position within the document.

def add_context(chunk: str, full_document: str) -> str:
    prompt = f"""Document: {full_document[:5000]}

    Chunk: {chunk}

    Write a short (2-3 sentence) context explaining what this chunk is about
    and where it fits in the document. Return ONLY the context."""

    context = llm.generate(prompt)
    return f"{context}\n\n{chunk}"

# Embed the contextual chunk. Improves retrieval accuracy by ~49%.
```

### Self-RAG (Adaptive Retrieval)
```
# LLM decides when to retrieve, evaluates quality, and self-corrects.

1. LLM receives question.
2. LLM decides: "Do I need retrieval?" (yes/no).
3. If yes: retrieve → LLM evaluates relevance of each chunk.
4. LLM generates answer with relevant chunks only.
5. LLM self-checks: "Is my answer supported by the evidence?"
6. If not: re-retrieve with refined query.
```

### Evaluation Metrics
| Metric | Measures | Target |
|--------|----------|--------|
| Retrieval precision | % of retrieved chunks that are relevant | > 80% |
| Retrieval recall | % of relevant chunks that were retrieved | > 90% |
| Answer faithfulness | Answer grounded in retrieved context | > 95% |
| Answer relevance | Answer addresses the question | > 90% |
| Context relevance | Retrieved context is useful for the question | > 80% |
| Latency (retrieval) | Time to retrieve chunks | < 200ms |
| Latency (total) | End-to-end response time | < 3s |
