# Database Performance Optimization

## Table of Contents
- [Query Optimization](#query-optimization)
- [EXPLAIN Analysis](#explain-analysis)
- [Connection Pooling](#connection-pooling)
- [Replication & Read Scaling](#replication--read-scaling)
- [Deadlock Prevention](#deadlock-prevention)
- [Capacity Planning](#capacity-planning)
- [Monitoring & Profiling](#monitoring--profiling)

## Query Optimization

### Top Optimization Techniques
| Technique | Impact | Effort |
|-----------|--------|--------|
| Add missing index | 10-1000x | Low |
| Rewrite N+1 to JOIN/subquery | 10-100x | Low |
| Add covering index | 2-10x | Low |
| Remove unnecessary columns (SELECT *) | 2-5x | Low |
| Use LIMIT for pagination | 2-10x | Low |
| Denormalize hot paths | 5-50x | Medium |
| Partition large tables | 2-10x | Medium |
| Connection pooling | 2-5x | Medium |
| Read replicas | 2x per replica | Medium |
| Caching layer | 100-1000x | Medium |

### Common Query Rewrites
```sql
-- Bad: SELECT * (fetches all columns, can't use covering index).
SELECT * FROM orders WHERE user_id = 123;

-- Good: select only needed columns.
SELECT id, status, total_cents, created_at
FROM orders WHERE user_id = 123;

-- Bad: N+1 queries (1 query + N queries per row).
-- PHP: foreach ($users as $user) { $user->orders(); }

-- Good: eager load with JOIN or IN.
SELECT u.*, o.id AS order_id, o.total_cents
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.id IN (1, 2, 3, 4, 5);

-- Bad: OFFSET pagination on large tables (scans all skipped rows).
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 100000;

-- Good: cursor/keyset pagination.
SELECT * FROM orders WHERE id > 100000 ORDER BY id LIMIT 20;

-- Bad: OR on different columns (can't use single index).
SELECT * FROM users WHERE email = 'x' OR phone = 'y';

-- Good: UNION ALL (each uses its own index).
SELECT * FROM users WHERE email = 'x'
UNION ALL
SELECT * FROM users WHERE phone = 'y' AND email != 'x';

-- Bad: function on indexed column (can't use index).
SELECT * FROM users WHERE YEAR(created_at) = 2025;

-- Good: range on column directly.
SELECT * FROM users
WHERE created_at >= '2025-01-01' AND created_at < '2026-01-01';

-- Bad: LIKE with leading wildcard (full scan).
SELECT * FROM products WHERE name LIKE '%widget%';

-- Good: full-text search.
SELECT * FROM products WHERE MATCH(name) AGAINST('widget' IN BOOLEAN MODE);
```

### Batch Operations
```sql
-- Bad: insert one at a time (N round trips).
INSERT INTO items (name, price) VALUES ('A', 100);
INSERT INTO items (name, price) VALUES ('B', 200);

-- Good: batch insert (1 round trip).
INSERT INTO items (name, price) VALUES ('A', 100), ('B', 200), ('C', 300);

-- Bad: update in loop.
-- Good: single UPDATE with CASE or JOIN.
UPDATE products
SET price = CASE id
    WHEN 1 THEN 9.99
    WHEN 2 THEN 19.99
    WHEN 3 THEN 29.99
END
WHERE id IN (1, 2, 3);
```

## EXPLAIN Analysis

### MySQL EXPLAIN
```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 123 AND status = 'paid';

-- Key output columns.
-- type: ALL (full scan) → index → range → ref → eq_ref → const (best).
-- possible_keys: which indexes could be used.
-- key: which index was actually used.
-- rows: estimated rows examined.
-- Extra: "Using index" (covering), "Using filesort" (bad), "Using temporary" (bad).
```

| type | Meaning | Performance |
|------|---------|-------------|
| ALL | Full table scan | Worst |
| index | Full index scan | Bad |
| range | Index range scan | OK |
| ref | Non-unique index lookup | Good |
| eq_ref | Unique index lookup (JOIN) | Very good |
| const | Single row (PK/UNIQUE) | Best |

### PostgreSQL EXPLAIN ANALYZE
```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE user_id = 123 AND status = 'paid';

-- Key output.
-- Seq Scan: full table scan (needs index).
-- Index Scan: using index, then fetching row.
-- Index Only Scan: covering index (best).
-- Bitmap Index Scan: combining multiple indexes.
-- actual time: real execution time.
-- rows: actual rows returned.
-- Buffers: shared hit (cached) vs read (disk).
```

### Red Flags in EXPLAIN
| Red Flag | Problem | Fix |
|----------|---------|-----|
| Seq Scan on large table | Full table scan | Add index |
| `Using filesort` | Sorting without index | Add ORDER BY to index |
| `Using temporary` | Temp table for GROUP BY | Optimize query or add index |
| rows >> actual rows | Bad statistics | `ANALYZE table` |
| Nested Loop with large inner | N*M complexity | Add index on join column |
| High `Buffers: read` | Data not cached | Increase buffer pool |

## Connection Pooling

### Why Pool
- DB connections are expensive (TCP + auth + memory per connection).
- MySQL: ~1MB per connection. PostgreSQL: ~5-10MB per fork.
- Application creates/destroys connections rapidly → overhead.
- Pooler maintains warm connections, reuses them.

### Pooler Comparison
| Pooler | Database | Mode | Features |
|--------|----------|------|----------|
| PgBouncer | PostgreSQL | Transaction/Session/Statement | Lightweight, standard |
| Pgpool-II | PostgreSQL | Session | Load balancing, replication |
| ProxySQL | MySQL | Connection multiplexing | Query routing, caching |
| Built-in (Laravel) | Any | Application-level | No extra infra |

### PgBouncer Configuration
```ini
[databases]
mydb = host=db.internal port=5432 dbname=mydb

[pgbouncer]
pool_mode = transaction           # Reuse per transaction (most efficient).
max_client_conn = 1000            # Clients can connect.
default_pool_size = 25            # Actual DB connections per pool.
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3
server_lifetime = 3600
server_idle_timeout = 600
```

### Application-Level Pooling
```php
// Laravel config/database.php.
'pgsql' => [
    'driver' => 'pgsql',
    'host' => env('DB_HOST'),
    'database' => env('DB_DATABASE'),
    'options' => [
        PDO::ATTR_PERSISTENT => true,    // Persistent connections.
    ],
],
```

## Replication & Read Scaling

### Topologies
| Topology | Consistency | Use Case |
|----------|------------|----------|
| Primary-Replica (async) | Eventual | Read scaling, reporting |
| Primary-Replica (semi-sync) | Near-strong | HA with low lag |
| Multi-Primary | Conflict resolution | Multi-region writes |
| Cascading | Eventual | Geographic distribution |

### Read/Write Splitting
```php
// Laravel: automatic read/write splitting.
'mysql' => [
    'read' => [
        ['host' => 'replica-1.example.com'],
        ['host' => 'replica-2.example.com'],
    ],
    'write' => [
        'host' => 'primary.example.com',
    ],
    'sticky' => true,    // After write, read from primary for session.
],
```

### Replication Lag Monitoring
```sql
-- MySQL: check seconds behind primary.
SHOW REPLICA STATUS\G
-- Look for: Seconds_Behind_Source.

-- PostgreSQL: check replication lag.
SELECT
    client_addr,
    state,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes
FROM pg_stat_replication;
```

## Deadlock Prevention

### Common Causes
1. **Inconsistent lock order**: TX1 locks A→B, TX2 locks B→A.
2. **Long transactions**: hold locks too long.
3. **Missing indexes**: full table scans acquire more locks.
4. **Large batch updates**: lock many rows simultaneously.

### Prevention Strategies
```sql
-- 1. Consistent lock order — always lock in same sequence.
-- Bad: TX1: UPDATE users, UPDATE orders; TX2: UPDATE orders, UPDATE users.
-- Good: always users first, then orders.

-- 2. Short transactions — minimize time between BEGIN and COMMIT.
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;

-- 3. SELECT ... FOR UPDATE with NOWAIT or SKIP LOCKED.
SELECT * FROM jobs WHERE status = 'pending'
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;    -- Skip locked rows, no waiting.

-- 4. Lock timeout.
SET innodb_lock_wait_timeout = 5;     -- MySQL: fail after 5s.
SET lock_timeout = '5s';              -- PostgreSQL.
```

### Detecting Deadlocks
```sql
-- MySQL: recent deadlock info.
SHOW ENGINE INNODB STATUS;    -- Look for LATEST DETECTED DEADLOCK.

-- PostgreSQL: enable logging.
-- postgresql.conf: log_lock_waits = on, deadlock_timeout = 1s.

-- Monitor locks.
SELECT * FROM pg_locks WHERE NOT granted;
```

## Capacity Planning

### Sizing Guidelines
| Metric | Formula | Example |
|--------|---------|---------|
| Storage | data_size × growth_rate × retention × 1.5 (overhead) | 50GB × 2x/yr × 3yr × 1.5 = 450GB |
| IOPS | peak_QPS × avg_IO_per_query | 1000 QPS × 4 IO = 4000 IOPS |
| Memory | working_set_size + connection_memory | 20GB data × 0.3 + 500 × 5MB = 8.5GB |
| CPU | f(query complexity, concurrency) | Profile under load |
| Connections | peak_concurrency × 1.2 | 100 × 1.2 = 120 |

### Growth Monitoring
```sql
-- MySQL: table sizes.
SELECT table_name,
    ROUND(data_length / 1024 / 1024, 2) AS data_mb,
    ROUND(index_length / 1024 / 1024, 2) AS index_mb,
    table_rows
FROM information_schema.tables
WHERE table_schema = 'mydb'
ORDER BY data_length DESC;

-- PostgreSQL: table sizes.
SELECT relname,
    pg_size_pretty(pg_total_relation_size(relid)) AS total,
    pg_size_pretty(pg_relation_size(relid)) AS data,
    pg_size_pretty(pg_indexes_size(relid)) AS indexes
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

## Monitoring & Profiling

### Key Metrics
| Metric | Warning | Critical |
|--------|---------|----------|
| Query latency (p99) | > 100ms | > 1s |
| Connections used | > 70% max | > 90% max |
| Replication lag | > 5s | > 30s |
| Disk usage | > 70% | > 85% |
| Deadlocks/min | > 0 | > 5 |
| Slow queries/min | > 10 | > 100 |
| Cache hit ratio | < 95% | < 90% |

### MySQL Performance Schema
```sql
-- Top slow queries.
SELECT DIGEST_TEXT, COUNT_STAR, AVG_TIMER_WAIT/1e12 AS avg_sec
FROM performance_schema.events_statements_summary_by_digest
ORDER BY AVG_TIMER_WAIT DESC
LIMIT 10;

-- Active connections.
SHOW PROCESSLIST;
SELECT * FROM information_schema.processlist WHERE command != 'Sleep';
```

### PostgreSQL pg_stat_statements
```sql
-- Enable: shared_preload_libraries = 'pg_stat_statements'.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top slow queries.
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Cache hit ratio (should be > 99%).
SELECT
    sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) AS cache_hit_ratio
FROM pg_statio_user_tables;
```

### Tools
| Tool | Use |
|------|-----|
| pt-query-digest (Percona) | MySQL slow query analysis |
| pg_stat_statements | PostgreSQL query stats |
| pgBadger | PostgreSQL log analysis |
| Percona PMM | MySQL/PG/MongoDB monitoring |
| Datadog / Grafana | Cross-engine dashboards |
| EXPLAIN ANALYZE | Per-query optimization |
