# Data Modeling & Schema Design

## Table of Contents
- [ER Modeling](#er-modeling)
- [Normalization](#normalization)
- [Denormalization](#denormalization)
- [Indexing Strategies](#indexing-strategies)
- [Partitioning](#partitioning)
- [Sharding](#sharding)
- [NoSQL Schema Design](#nosql-schema-design)
- [Common Patterns](#common-patterns)

## ER Modeling

### Relationship Types
| Type | Example | SQL Implementation |
|------|---------|-------------------|
| 1:1 | User ↔ Profile | FK with UNIQUE constraint |
| 1:N | User → Orders | FK on the "many" side |
| N:M | Students ↔ Courses | Junction/pivot table |
| Self-referential | Employee → Manager | FK referencing same table |
| Polymorphic | Comment → Post/Video | Discriminator column + FK |

### 1:N Pattern
```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    status ENUM('pending', 'paid', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    total_cents INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_orders_user_id (user_id),
    INDEX idx_orders_status_created (status, created_at)
);
```

### N:M Pattern
```sql
CREATE TABLE students (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE courses (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL
);

-- Junction table with composite PK.
CREATE TABLE enrollments (
    student_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    grade DECIMAL(3,2),
    PRIMARY KEY (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
```

### Polymorphic Associations
```sql
-- Option 1: Discriminator column (simple, less strict).
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    commentable_type VARCHAR(50) NOT NULL,    -- 'post', 'video', 'article'.
    commentable_id BIGINT NOT NULL,
    body TEXT NOT NULL,
    INDEX idx_commentable (commentable_type, commentable_id)
);

-- Option 2: Separate FK columns (stricter, nullable).
CREATE TABLE comments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    post_id BIGINT NULL,
    video_id BIGINT NULL,
    body TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    CONSTRAINT chk_one_parent CHECK (
        (post_id IS NOT NULL AND video_id IS NULL)
        OR (post_id IS NULL AND video_id IS NOT NULL)
    )
);
```

## Normalization

### Normal Forms
| Form | Rule | Violation Example |
|------|------|-------------------|
| 1NF | Atomic values, no repeating groups | `tags: "php,mysql,redis"` |
| 2NF | No partial dependencies (non-key depends on full PK) | `order_items.product_name` depending only on `product_id` |
| 3NF | No transitive dependencies | `orders.customer_city` derived via `customer_id` |
| BCNF | Every determinant is a candidate key | Rare, usually 3NF is sufficient |

### When to Normalize (3NF)
- Transactional systems (OLTP).
- Data integrity is critical.
- Write-heavy workloads.
- Data changes frequently.

### Example: Unnormalized → 3NF
```sql
-- Bad: unnormalized.
CREATE TABLE orders (
    id INT,
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    product_name VARCHAR(255),
    product_price DECIMAL(10,2),
    quantity INT
);

-- Good: 3NF.
CREATE TABLE customers (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    price_cents INT NOT NULL
);

CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    customer_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE order_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    unit_price_cents INT NOT NULL,    -- Snapshot at order time.
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

## Denormalization

### When to Denormalize
- Read-heavy workloads (reporting, dashboards).
- Expensive JOINs on large tables.
- Caching computed values.
- NoSQL databases (denormalization is the norm).

### Techniques
| Technique | Example | Trade-off |
|-----------|---------|-----------|
| Redundant columns | `orders.customer_name` | Stale if customer changes |
| Materialized views | Pre-computed aggregates | Storage + refresh cost |
| Summary tables | `daily_sales(date, total)` | Eventual consistency |
| Computed columns | `total_formatted` | CPU on write |
| JSON columns | `metadata JSON` | Harder to query/index |

```sql
-- Materialized view (PostgreSQL).
CREATE MATERIALIZED VIEW daily_revenue AS
SELECT
    DATE(created_at) AS date,
    COUNT(*) AS order_count,
    SUM(total_cents) AS revenue_cents
FROM orders
WHERE status = 'paid'
GROUP BY DATE(created_at);

-- Refresh.
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;

-- MySQL: use summary table with scheduled refresh.
CREATE TABLE daily_revenue (
    date DATE PRIMARY KEY,
    order_count INT NOT NULL,
    revenue_cents BIGINT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Indexing Strategies

### Index Types
| Type | Engine | Use Case |
|------|--------|----------|
| B-Tree | All SQL | Default: equality, range, sorting |
| Hash | MySQL (Memory) | Exact match only |
| GIN | PostgreSQL | Arrays, JSONB, full-text |
| GiST | PostgreSQL | Geospatial, ranges |
| BRIN | PostgreSQL | Large sequential tables (time-series) |
| Full-Text | MySQL/PG | Text search |

### Index Design Rules
1. **Index columns in WHERE, JOIN, ORDER BY.**
2. **Composite index order matters**: most selective → least selective, or ESR rule (Equality, Sort, Range).
3. **Covering indexes**: include all SELECT columns to avoid table lookup.
4. **Partial indexes** (PG): index only relevant rows.
5. **Don't over-index**: each index slows writes and uses storage.

```sql
-- Composite index: order matters.
-- Supports: WHERE status = 'active' AND created_at > '2025-01-01'
-- Supports: WHERE status = 'active'
-- Does NOT support: WHERE created_at > '2025-01-01' (alone)
CREATE INDEX idx_status_created ON orders (status, created_at);

-- Covering index: query served entirely from index.
CREATE INDEX idx_covering ON orders (status, created_at, total_cents);
-- SELECT total_cents FROM orders WHERE status = 'paid' ORDER BY created_at;
-- No table lookup needed.

-- Partial index (PostgreSQL).
CREATE INDEX idx_unprocessed ON orders (created_at)
    WHERE status = 'pending';
-- Only indexes pending orders — much smaller.

-- Expression index.
CREATE INDEX idx_email_lower ON users (LOWER(email));
```

### Finding Missing Indexes
```sql
-- MySQL: slow query log + pt-query-digest.
-- PostgreSQL: pg_stat_user_tables.
SELECT schemaname, relname, seq_scan, idx_scan,
       seq_scan - idx_scan AS too_many_seq_scans
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan
ORDER BY too_many_seq_scans DESC;

-- Unused indexes (PostgreSQL).
SELECT indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

## Partitioning

### When to Partition
- Tables exceeding 100GB.
- Time-series data with range queries.
- Data lifecycle management (drop old partitions).
- Query patterns align with partition key.

### Types
| Type | Key | Use Case |
|------|-----|----------|
| Range | Date, ID range | Time-series, logs, events |
| List | Status, region, category | Known discrete values |
| Hash | User ID, account ID | Even distribution |

```sql
-- PostgreSQL declarative partitioning.
CREATE TABLE events (
    id BIGSERIAL,
    event_type VARCHAR(50),
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2025_01 PARTITION OF events
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE events_2025_02 PARTITION OF events
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- MySQL range partitioning.
CREATE TABLE logs (
    id BIGINT AUTO_INCREMENT,
    message TEXT,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
    PARTITION p202501 VALUES LESS THAN (202502),
    PARTITION p202502 VALUES LESS THAN (202503),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

## Sharding

### Strategies
| Strategy | How | Pros | Cons |
|----------|-----|------|------|
| Range-based | Shard by ID range | Simple, sequential | Hot spots on active range |
| Hash-based | Hash(key) % N shards | Even distribution | Range queries span all shards |
| Directory-based | Lookup table maps key→shard | Flexible | Lookup overhead, SPOF |
| Geographic | Shard by region | Data locality | Uneven distribution |

### Application-Level Sharding
```php
function getShard(int $userId): PDO {
    $shardId = $userId % NUM_SHARDS;
    return getConnection("shard_{$shardId}");
}
```

### When to Shard
- Single node can't handle write throughput.
- Dataset exceeds single node storage/memory.
- First try: read replicas, vertical scaling, query optimization, caching.
- Sharding is a last resort — adds significant complexity.

## NoSQL Schema Design

### Document (MongoDB) — Embed vs Reference
| Embed When | Reference When |
|------------|----------------|
| 1:1 or 1:few | 1:many (unbounded) |
| Always accessed together | Accessed independently |
| Rarely changes | Frequently updated |
| < 16MB document limit | Large subdocuments |

### Key-Value (Redis/DynamoDB) — Access Pattern First
```
# Design around access patterns, not entity relationships.
# Key naming convention: entity:id:attribute

user:123:profile        → { name, email }
user:123:orders         → [order_ids...]
order:456               → { user_id, items, total }
leaderboard:weekly      → sorted set
```

### Wide-Column (Cassandra) — Query-First
```
# One table per query pattern.
# Table: "orders by user" (query: get all orders for a user).
# Table: "orders by date" (query: get orders in date range).
# Duplicate data across tables — this is expected.
```

## Common Patterns

### Soft Deletes
```sql
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP NULL;
CREATE INDEX idx_users_active ON users (id) WHERE deleted_at IS NULL;

-- All queries filter: WHERE deleted_at IS NULL.
```

### Audit Trail
```sql
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id BIGINT NOT NULL,
    action ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
    old_values JSON,
    new_values JSON,
    user_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_table_record (table_name, record_id),
    INDEX idx_audit_created (created_at)
);
```

### Optimistic Locking
```sql
-- Version column.
UPDATE products
SET name = 'New Name', version = version + 1
WHERE id = 123 AND version = 5;
-- If 0 rows affected → concurrent modification, retry.
```

### UUID vs Auto-Increment
| Feature | Auto-Increment | UUID v7 |
|---------|---------------|---------|
| Size | 4-8 bytes | 16 bytes |
| Ordering | Sequential | Time-ordered (v7) |
| Security | Predictable | Non-guessable |
| Distributed | Conflicts | No conflicts |
| Index perf | Excellent (sequential) | Good (v7 is sorted) |
| Best for | Single-DB OLTP | Distributed, APIs |
