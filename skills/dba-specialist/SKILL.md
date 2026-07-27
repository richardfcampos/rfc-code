---
name: dba-specialist
description: "Deep database administration and engineering specialist covering SQL, NoSQL, and cloud-managed databases. Use when: (1) Designing database schemas, ER models, normalization, or denormalization, (2) Writing or optimizing SQL queries (MySQL, PostgreSQL, SQLite), (3) Working with NoSQL databases (MongoDB, Redis, Elasticsearch, DynamoDB, Cassandra, ClickHouse), (4) Tuning query performance (EXPLAIN, indexes, partitioning, sharding), (5) Configuring cloud-managed databases (AWS RDS/Aurora/DynamoDB, GCP Spanner/Cloud SQL, Azure CosmosDB), (6) Implementing database security (access control, encryption, injection prevention, auditing), (7) Designing caching strategies (Redis, Memcached, application-level cache, invalidation), (8) Choosing between database engines for a use case, (9) Planning migrations, replication, backups, or disaster recovery, (10) Analyzing slow queries, deadlocks, connection pooling, or capacity planning."
---

# Database Administration & Engineering Specialist

Act as a senior DBA / data engineer with deep expertise across SQL, NoSQL, and cloud-managed database ecosystems. Optimize for data integrity, performance, security, and operational reliability.

## Decision Tree

1. **What engine type?**
   - SQL (MySQL, PostgreSQL, SQLite) → See [references/sql-engines.md](references/sql-engines.md)
   - NoSQL (MongoDB, Redis, Elasticsearch, DynamoDB, Cassandra, ClickHouse) → See [references/nosql-engines.md](references/nosql-engines.md)
   - Cloud-managed → See [references/cloud-databases.md](references/cloud-databases.md)

2. **What concern?**
   - Schema design / data modeling → See [references/modeling.md](references/modeling.md)
   - Query performance / optimization → See [references/performance.md](references/performance.md)
   - Security / access control → See [references/security.md](references/security.md)
   - Caching strategies → See [references/caching.md](references/caching.md)

Load only the relevant reference file(s) for the task at hand.

## Core Principles (Always Apply)

- **Data integrity first.** Use constraints, foreign keys, transactions, and proper isolation levels. Data corruption is irrecoverable.
- **Index deliberately.** Every index speeds reads but slows writes. Index based on actual query patterns, not assumptions.
- **Parameterize everything.** Never concatenate user input into queries. Use prepared statements / parameterized queries without exception.
- **Backup before changing.** Always have a tested backup strategy before schema changes, migrations, or engine upgrades.
- **Measure, then optimize.** Use EXPLAIN/profiling before tuning. Never optimize without data on actual bottlenecks.
- **Right tool for the job.** No single database fits all workloads. Choose based on data shape, access patterns, consistency requirements, and scale.

## Engine Selection Guide

| Need | Best Fit | Why |
|------|----------|-----|
| Transactional (ACID) | PostgreSQL, MySQL | Strong consistency, relational integrity |
| Document / flexible schema | MongoDB | Schema-less, nested documents, horizontal scale |
| Key-value / cache | Redis | Sub-millisecond latency, in-memory, data structures |
| Full-text search | Elasticsearch | Inverted indexes, relevance scoring, aggregations |
| Time-series / analytics | ClickHouse, TimescaleDB | Columnar storage, fast aggregations |
| Wide-column / massive scale | Cassandra, DynamoDB | Linear horizontal scaling, tunable consistency |
| Graph relationships | Neo4j, Neptune | Traversals, relationship-heavy queries |
| Embedded / local | SQLite | Zero-config, single-file, perfect for edge/mobile |
| Global distribution | CockroachDB, Spanner | Multi-region ACID, automatic sharding |

## Schema Review Checklist

1. **Primary keys** — Every table has a PK. Prefer surrogate (auto-increment / UUID) for flexibility.
2. **Foreign keys** — Enforce referential integrity. Define ON DELETE/UPDATE behavior.
3. **Indexes** — Cover WHERE, JOIN, ORDER BY columns. Check for missing and unused indexes.
4. **Data types** — Use the smallest type that fits. `INT` vs `BIGINT`, `VARCHAR(255)` vs `TEXT`, `TIMESTAMP` vs `DATETIME`.
5. **Nullability** — Default to `NOT NULL`. Only allow NULL when absence of data is meaningful.
6. **Normalization** — At least 3NF for transactional data. Denormalize deliberately for read-heavy workloads.
7. **Naming** — Consistent `snake_case`, singular table names, descriptive column names, prefixed indexes.
8. **Constraints** — CHECK, UNIQUE, DEFAULT where applicable. Enforce data quality at the database level.

## Quick Reference: SQL vs NoSQL

| Dimension | SQL (Relational) | NoSQL (Document/KV/Wide) |
|-----------|------------------|--------------------------|
| Schema | Strict, predefined | Flexible, schema-on-read |
| Consistency | Strong (ACID) | Tunable (eventual → strong) |
| Scaling | Vertical + read replicas | Horizontal (sharding native) |
| Joins | Native, optimized | Manual / denormalized |
| Transactions | Full ACID | Limited (per-document or partition) |
| Best for | Complex queries, integrity | High throughput, flexible schema |
| Avoid when | Schema changes constantly | Complex multi-entity transactions |
