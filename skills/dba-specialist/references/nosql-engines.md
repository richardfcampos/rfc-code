# NoSQL Database Engines

## Table of Contents
- [MongoDB](#mongodb)
- [Redis](#redis)
- [Elasticsearch](#elasticsearch)
- [DynamoDB](#dynamodb)
- [Cassandra](#cassandra)
- [ClickHouse](#clickhouse)
- [Engine Comparison](#engine-comparison)

## MongoDB

### When to Use
- Flexible/evolving schema, nested documents.
- Content management, catalogs, user profiles.
- Rapid prototyping, schema-on-read workflows.
- Horizontal scaling with sharding.

### Schema Design
```javascript
// Embed when: 1:1 or 1:few, always accessed together.
{
  _id: ObjectId("..."),
  name: "John Doe",
  address: {              // Embedded document.
    street: "123 Main St",
    city: "Springfield",
    state: "IL"
  },
  orders: [               // Embed if < ~100 items and always queried together.
    { product: "Widget", qty: 2, price: 9.99 }
  ]
}

// Reference when: 1:many or many:many, independent access, large subdocuments.
{
  _id: ObjectId("..."),
  name: "John Doe",
  order_ids: [ObjectId("..."), ObjectId("...")]    // References.
}
```

### Indexing
```javascript
// Single field.
db.users.createIndex({ email: 1 }, { unique: true });

// Compound (order matters — follows ESR: Equality, Sort, Range).
db.orders.createIndex({ status: 1, created_at: -1, total: 1 });

// Text search.
db.articles.createIndex({ title: "text", body: "text" });

// TTL (auto-expire documents).
db.sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

// Partial (index subset).
db.users.createIndex(
  { email: 1 },
  { partialFilterExpression: { status: "active" } }
);
```

### Aggregation Pipeline
```javascript
db.orders.aggregate([
  { $match: { status: "completed", created_at: { $gte: ISODate("2025-01-01") } } },
  { $unwind: "$items" },
  { $group: {
      _id: "$items.category",
      total_revenue: { $sum: "$items.price" },
      count: { $sum: 1 }
  }},
  { $sort: { total_revenue: -1 } },
  { $limit: 10 }
]);
```

### Replication & Sharding
- **Replica Set**: 3+ nodes (1 primary, 2+ secondaries). Automatic failover.
- **Sharding**: Shard key determines data distribution. Choose high-cardinality, write-distributed key.
- **Read Preference**: `primary` (consistent), `primaryPreferred`, `secondary` (stale OK), `nearest` (lowest latency).

## Redis

### When to Use
- Caching (sessions, API responses, computed results).
- Rate limiting, leaderboards, counters.
- Pub/sub messaging, real-time features.
- Distributed locks, job queues.

### Data Structures
| Type | Commands | Use Case |
|------|----------|----------|
| String | `SET`, `GET`, `INCR`, `MGET` | Cache, counters, flags |
| Hash | `HSET`, `HGET`, `HGETALL` | Object storage, user sessions |
| List | `LPUSH`, `RPOP`, `LRANGE` | Queues, activity feeds |
| Set | `SADD`, `SMEMBERS`, `SINTER` | Tags, unique visitors |
| Sorted Set | `ZADD`, `ZRANGE`, `ZRANK` | Leaderboards, time-series |
| Stream | `XADD`, `XREAD`, `XREADGROUP` | Event sourcing, message queue |
| HyperLogLog | `PFADD`, `PFCOUNT` | Cardinality estimation |

### Patterns
```redis
-- Cache with TTL.
SET user:123 '{"name":"John"}' EX 3600

-- Distributed lock (Redlock pattern).
SET lock:order:456 unique_id NX EX 30
-- Release: check value before DEL.

-- Rate limiting (sliding window).
MULTI
ZADD rate:user:123 <now> <request_id>
ZREMRANGEBYSCORE rate:user:123 0 <now - window>
ZCARD rate:user:123
EXPIRE rate:user:123 <window>
EXEC

-- Leaderboard.
ZADD leaderboard 1500 "player:1"
ZADD leaderboard 2300 "player:2"
ZREVRANGE leaderboard 0 9 WITHSCORES    -- Top 10.

-- Pub/Sub.
SUBSCRIBE events:orders
PUBLISH events:orders '{"order_id": 123, "action": "created"}'
```

### Configuration
```ini
# Memory policy — what to evict when maxmemory reached.
maxmemory 2gb
maxmemory-policy allkeys-lru    # LRU for cache. Use volatile-lru for mixed.

# Persistence.
save 900 1         # RDB snapshot: save if 1 key changed in 900s.
save 300 10
appendonly yes     # AOF: log every write (more durable).
appendfsync everysec

# Connections.
maxclients 10000
timeout 300
```

### Cluster vs Sentinel
| Feature | Sentinel | Cluster |
|---------|----------|---------|
| Purpose | HA + failover | HA + sharding |
| Data distribution | Single node | 16384 hash slots |
| Max data | Single node RAM | Sum of all nodes |
| Multi-key ops | Full support | Same-slot only |

## Elasticsearch

### When to Use
- Full-text search with relevance scoring.
- Log aggregation and analysis (ELK stack).
- Faceted search, autocomplete, fuzzy matching.
- Time-series analytics, dashboards.

### Index Design
```json
{
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "english",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "status": { "type": "keyword" },
      "price": { "type": "float" },
      "created_at": { "type": "date" },
      "tags": { "type": "keyword" },
      "location": { "type": "geo_point" }
    }
  },
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "5s"
  }
}
```

### Query DSL
```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "database performance" } }
      ],
      "filter": [
        { "term": { "status": "published" } },
        { "range": { "created_at": { "gte": "2025-01-01" } } }
      ],
      "should": [
        { "match": { "tags": "postgresql" } }
      ],
      "minimum_should_match": 0
    }
  },
  "aggs": {
    "by_tag": {
      "terms": { "field": "tags", "size": 20 }
    }
  },
  "highlight": {
    "fields": { "title": {}, "body": {} }
  },
  "size": 10,
  "from": 0
}
```

### Best Practices
- **Index per time period** for logs: `logs-2025.01`, `logs-2025.02`. Use ILM for lifecycle.
- **Avoid mapping explosion**: limit dynamic fields, use `strict` mapping.
- **Bulk API** for indexing: batch 5-15MB per request.
- **Refresh interval**: increase to 30s+ for write-heavy workloads.

## DynamoDB

### When to Use
- Serverless / pay-per-request workloads.
- Single-digit millisecond latency at any scale.
- Key-value or simple document access patterns.
- AWS-native applications.

### Key Design
```
# Single-table design — model multiple entities in one table.
PK (Partition Key)     SK (Sort Key)           Attributes
USER#123               PROFILE                 name, email, ...
USER#123               ORDER#2025-01-15#456    total, status, ...
USER#123               ORDER#2025-01-20#789    total, status, ...
PRODUCT#abc            INFO                    name, price, ...
PRODUCT#abc            REVIEW#123              rating, text, ...

# Access patterns drive the schema, not entity relationships.
```

### Indexing
- **Primary key**: Partition Key (PK) + optional Sort Key (SK).
- **GSI** (Global Secondary Index): alternate PK+SK, eventually consistent.
- **LSI** (Local Secondary Index): same PK, different SK, strongly consistent.

### Capacity Modes
| Mode | Billing | Use When |
|------|---------|----------|
| On-Demand | Per request | Unpredictable traffic |
| Provisioned | Per RCU/WCU | Predictable, cost-sensitive |
| Provisioned + Auto-Scaling | Hybrid | Somewhat predictable |

## Cassandra

### When to Use
- Massive write throughput (millions of writes/sec).
- Multi-datacenter / multi-region replication.
- Time-series, IoT sensor data, audit logs.
- Tunable consistency (AP in CAP theorem).

### Data Modeling Rules
1. **Query-first design** — model tables around query patterns.
2. **Denormalize aggressively** — no joins, duplicate data across tables.
3. **Partition key** determines data distribution. Must be high-cardinality.
4. **Clustering columns** define sort order within partition.
5. **Keep partitions under 100MB**.

```sql
CREATE TABLE sensor_readings (
    sensor_id UUID,
    reading_date DATE,
    reading_time TIMESTAMP,
    value DOUBLE,
    PRIMARY KEY ((sensor_id, reading_date), reading_time)
) WITH CLUSTERING ORDER BY (reading_time DESC);
```

### Consistency Levels
| Level | Reads/Writes | Use Case |
|-------|-------------|----------|
| ONE | Fastest, least consistent | Logging, metrics |
| QUORUM | Majority nodes agree | General workloads |
| LOCAL_QUORUM | Majority in local DC | Multi-DC with local consistency |
| ALL | All replicas | Rarely — sacrifices availability |

## ClickHouse

### When to Use
- OLAP / analytics on billions of rows.
- Real-time dashboards and aggregations.
- Log analysis, event analytics.
- Columnar queries (SELECT few columns from huge tables).

### Table Engines
```sql
-- MergeTree — primary engine for analytics.
CREATE TABLE events (
    event_date Date,
    event_time DateTime,
    user_id UInt64,
    event_type LowCardinality(String),
    properties String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_type, user_id, event_time)
TTL event_date + INTERVAL 90 DAY;

-- Aggregating MergeTree — pre-aggregated rollups.
CREATE MATERIALIZED VIEW events_daily
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type)
AS SELECT
    event_date,
    event_type,
    countState() AS event_count,
    uniqState(user_id) AS unique_users
FROM events
GROUP BY event_date, event_type;
```

### Performance Tips
- **ORDER BY** in table = primary index. Choose columns that match query filters.
- **LowCardinality** for columns with < 10,000 distinct values.
- **Partitioning** by month/week for time-series.
- **TTL** for automatic data expiration.
- Avoid `SELECT *` — ClickHouse is columnar, only select needed columns.

## Engine Comparison

| Feature | MongoDB | Redis | Elasticsearch | DynamoDB | Cassandra | ClickHouse |
|---------|---------|-------|--------------|----------|-----------|------------|
| Model | Document | Key-Value | Search | Key-Value | Wide-Column | Columnar |
| Query | Rich (MQL) | Commands | DSL (JSON) | Key/Scan | CQL | SQL-like |
| Consistency | Tunable | Strong | Eventually | Tunable | Tunable | Strong |
| Scaling | Sharding | Cluster | Sharding | Auto | Linear | Sharding |
| Joins | $lookup | No | No | No | No | Yes (limited) |
| Transactions | Multi-doc | MULTI | No | Per-item/TX | Lightweight | No |
| Best for | General docs | Cache/RT | Search/Logs | Serverless KV | Writes/IoT | Analytics |
