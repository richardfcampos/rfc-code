# SQL Database Engines

## Table of Contents
- [MySQL / MariaDB](#mysql--mariadb)
- [PostgreSQL](#postgresql)
- [SQLite](#sqlite)
- [Engine Comparison](#engine-comparison)

## MySQL / MariaDB

### Storage Engines
| Engine | Use Case | Transactions | Full-Text |
|--------|----------|-------------|-----------|
| InnoDB (default) | General OLTP | Yes (ACID) | Yes (5.6+) |
| MyISAM | Legacy read-heavy | No | Yes |
| MEMORY | Temp tables, cache | No | No |
| Aria (MariaDB) | Crash-safe MyISAM | No | Yes |

Always use InnoDB unless there's a specific reason not to.

### Key Configuration
```ini
# InnoDB buffer pool — 70-80% of available RAM.
innodb_buffer_pool_size = 12G
innodb_buffer_pool_instances = 8

# Log file — larger = better write performance, slower recovery.
innodb_log_file_size = 2G
innodb_log_buffer_size = 64M

# Flush settings.
innodb_flush_log_at_trx_commit = 1    # 1=ACID compliant, 2=faster but risk 1s loss.
innodb_flush_method = O_DIRECT         # Avoid double buffering.

# Connections.
max_connections = 500
wait_timeout = 300
interactive_timeout = 300

# Query cache (MySQL 8.0 removed it — use application cache).
# MariaDB: query_cache_type = ON, query_cache_size = 128M.

# Slow query log.
slow_query_log = ON
long_query_time = 1
log_queries_not_using_indexes = ON
```

### MySQL-Specific Features
```sql
-- JSON support.
CREATE TABLE events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    data JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_data_type ((CAST(data->>'$.type' AS CHAR(50))))
);

-- Generated columns.
ALTER TABLE orders ADD COLUMN total_formatted VARCHAR(20)
    GENERATED ALWAYS AS (CONCAT('$', FORMAT(total_cents / 100, 2))) VIRTUAL;

-- Window functions.
SELECT
    name,
    department,
    salary,
    RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank
FROM employees;

-- CTE (Common Table Expressions).
WITH ranked_products AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY sales DESC) AS rn
    FROM products
)
SELECT * FROM ranked_products WHERE rn <= 5;

-- Online DDL (InnoDB).
ALTER TABLE users ADD COLUMN phone VARCHAR(20), ALGORITHM=INPLACE, LOCK=NONE;
```

### Replication
```
# Primary-Replica (async).
# Primary: binlog enabled, server-id unique.
# Replica: CHANGE REPLICATION SOURCE TO ... ;

# Semi-synchronous: at least one replica confirms.
# Group Replication: multi-primary or single-primary with auto failover.

# MariaDB Galera Cluster: synchronous multi-master.
```

## PostgreSQL

### Key Advantages Over MySQL
- Advanced data types (JSONB, arrays, ranges, hstore, inet, UUID).
- Full ACID on all operations.
- Partial indexes, expression indexes, GIN/GiST indexes.
- CTEs with `MATERIALIZED` / `NOT MATERIALIZED` control.
- Native partitioning (declarative).
- Row-level security policies.
- Extensions ecosystem (PostGIS, pg_trgm, pgvector, TimescaleDB).

### Key Configuration
```ini
# Memory — shared_buffers: 25% of RAM.
shared_buffers = 4GB
effective_cache_size = 12GB    # OS cache estimate (75% RAM).
work_mem = 64MB                # Per-sort/hash operation.
maintenance_work_mem = 1GB     # VACUUM, CREATE INDEX.

# WAL.
wal_buffers = 64MB
max_wal_size = 4GB
min_wal_size = 1GB
checkpoint_completion_target = 0.9

# Connections.
max_connections = 200          # Use pgBouncer for pooling.

# Autovacuum — keep aggressive.
autovacuum_max_workers = 4
autovacuum_naptime = 30s
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02

# Logging.
log_min_duration_statement = 500    # Log queries > 500ms.
log_checkpoints = on
log_lock_waits = on
```

### PostgreSQL-Specific Features
```sql
-- JSONB (indexed, queryable).
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_events_data ON events USING GIN (data);

SELECT * FROM events WHERE data @> '{"type": "purchase"}';
SELECT data->>'user_id' FROM events WHERE data->'amount' > '100';

-- Array columns.
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}'
);
CREATE INDEX idx_tags ON articles USING GIN (tags);
SELECT * FROM articles WHERE 'postgresql' = ANY(tags);

-- Partial index (index only matching rows).
CREATE INDEX idx_active_users ON users (email) WHERE status = 'active';

-- Expression index.
CREATE INDEX idx_lower_email ON users (LOWER(email));

-- Declarative partitioning.
CREATE TABLE logs (
    id BIGSERIAL,
    created_at TIMESTAMPTZ NOT NULL,
    message TEXT
) PARTITION BY RANGE (created_at);

CREATE TABLE logs_2025_01 PARTITION OF logs
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- Row-Level Security.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_documents ON documents
    USING (owner_id = current_setting('app.user_id')::INT);

-- LISTEN/NOTIFY (real-time events).
LISTEN order_created;
NOTIFY order_created, '{"order_id": 123}';

-- Full-text search (built-in).
SELECT * FROM articles
WHERE to_tsvector('english', title || ' ' || body) @@ to_tsquery('database & performance');
```

### Extensions
| Extension | Purpose |
|-----------|---------|
| `pg_trgm` | Fuzzy text search, similarity matching |
| `PostGIS` | Geospatial queries and data types |
| `pgvector` | Vector similarity search (AI embeddings) |
| `TimescaleDB` | Time-series optimization |
| `pg_stat_statements` | Query performance tracking |
| `pgcrypto` | Cryptographic functions |
| `uuid-ossp` | UUID generation |
| `pg_partman` | Automated partition management |

## SQLite

### When to Use
- Embedded applications, mobile, desktop, edge.
- Single-writer workloads.
- Testing and prototyping.
- Configuration storage.
- Under 1TB, under ~100 concurrent writers.

### When NOT to Use
- High write concurrency (use PostgreSQL/MySQL).
- Multi-server access (use client-server DB).
- Large-scale web applications.

### Key Configuration (PRAGMA)
```sql
-- WAL mode — concurrent reads during writes.
PRAGMA journal_mode = WAL;

-- Synchronous: NORMAL is safe with WAL.
PRAGMA synchronous = NORMAL;

-- Cache size: negative = KB.
PRAGMA cache_size = -64000;    -- 64MB.

-- Foreign keys (off by default!).
PRAGMA foreign_keys = ON;

-- Busy timeout (ms) — wait instead of failing on lock.
PRAGMA busy_timeout = 5000;

-- Memory-mapped I/O.
PRAGMA mmap_size = 268435456;  -- 256MB.
```

## Engine Comparison

| Feature | MySQL 8.4 | PostgreSQL 17 | SQLite |
|---------|-----------|---------------|--------|
| ACID | Yes (InnoDB) | Yes | Yes (WAL) |
| JSON | JSON type | JSONB (indexed) | JSON functions |
| Full-text | Yes | Yes (tsvector) | FTS5 extension |
| Partitioning | Hash, Range, List, Key | Declarative Range/List/Hash | Manual |
| Replication | Primary-Replica, Group | Streaming, Logical | N/A |
| Max connections | ~10,000 | ~500 (use pgBouncer) | 1 writer |
| Window functions | Yes | Yes (advanced) | Yes |
| CTEs | Yes | Yes (MATERIALIZED) | Yes |
| Extensions | Plugins | Rich ecosystem | Loadable |
| Licensing | GPL | PostgreSQL (permissive) | Public domain |
