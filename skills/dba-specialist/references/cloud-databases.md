# Cloud-Managed Databases

## Table of Contents
- [AWS Database Services](#aws-database-services)
- [GCP Database Services](#gcp-database-services)
- [Azure Database Services](#azure-database-services)
- [Cloud Selection Guide](#cloud-selection-guide)
- [Migration Strategies](#migration-strategies)
- [Backup & Disaster Recovery](#backup--disaster-recovery)

## AWS Database Services

### RDS (Relational Database Service)
| Engine | Use Case | Max Storage | Multi-AZ |
|--------|----------|-------------|----------|
| MySQL | General OLTP | 128 TiB | Yes |
| PostgreSQL | Advanced OLTP | 128 TiB | Yes |
| MariaDB | MySQL-compatible | 128 TiB | Yes |
| Oracle | Enterprise / legacy | 128 TiB | Yes |
| SQL Server | .NET / Windows | 16 TiB | Yes |

```hcl
# Terraform RDS example.
resource "aws_db_instance" "main" {
  engine               = "postgres"
  engine_version       = "17.2"
  instance_class       = "db.r7g.xlarge"
  allocated_storage    = 100
  max_allocated_storage = 500    # Auto-scaling.
  storage_encrypted    = true

  multi_az             = true
  publicly_accessible  = false
  db_subnet_group_name = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  backup_retention_period = 14
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"

  performance_insights_enabled = true
  monitoring_interval         = 60

  deletion_protection = true
  skip_final_snapshot = false
  final_snapshot_identifier = "main-final"
}
```

### Aurora
- **MySQL-compatible** and **PostgreSQL-compatible**.
- 5x throughput of MySQL, 3x of PostgreSQL.
- Storage auto-scales to 128 TiB. 6-way replication across 3 AZs.
- **Aurora Serverless v2**: auto-scales compute (0.5 to 128 ACUs).
- **Global Database**: cross-region replication < 1s lag.

### DynamoDB
- Fully managed NoSQL, single-digit ms latency.
- On-demand or provisioned capacity.
- DAX (in-memory cache): microsecond reads.
- Global Tables: multi-region, active-active.
- Streams: CDC (change data capture) for event-driven architectures.

### ElastiCache
- Managed Redis or Memcached.
- Redis: persistence, replication, Cluster mode.
- Memcached: simple caching, multi-threaded.

### Other AWS
| Service | Type | Use Case |
|---------|------|----------|
| Redshift | Columnar DW | Analytics, BI |
| Neptune | Graph | Social networks, knowledge graphs |
| DocumentDB | MongoDB-compatible | Document workloads |
| Timestream | Time-series | IoT, DevOps metrics |
| Keyspaces | Cassandra-compatible | Wide-column workloads |
| MemoryDB | Redis-compatible | Durable in-memory |

## GCP Database Services

### Cloud SQL
- Managed MySQL, PostgreSQL, SQL Server.
- Automatic backups, replicas, HA.
- Up to 128 vCPUs, 864 GB RAM.

### Cloud Spanner
- Globally distributed relational database.
- Unlimited horizontal scale with strong consistency.
- SQL interface with ACID transactions across regions.
- Best for: financial systems, global inventory, multi-region apps.

### Firestore
- Serverless document database.
- Real-time sync for mobile/web.
- Strong consistency, offline support.

### AlloyDB
- PostgreSQL-compatible, 4x faster than standard PostgreSQL.
- Columnar engine for analytics + transactional in same database.

### Other GCP
| Service | Type | Use Case |
|---------|------|----------|
| BigQuery | Columnar DW | Analytics, ML, BI |
| Bigtable | Wide-column | Time-series, IoT at scale |
| Memorystore | Redis/Memcached | Caching |

## Azure Database Services

### Azure SQL
- Fully managed SQL Server.
- Hyperscale: up to 100 TB, rapid scale-out.
- Serverless: auto-pause, pay-per-use.

### Cosmos DB
- Multi-model: document, key-value, graph, column-family.
- Global distribution with tunable consistency (5 levels).
- Single-digit ms latency, 99.999% SLA.
- APIs: SQL, MongoDB, Cassandra, Gremlin, Table.

### Other Azure
| Service | Type | Use Case |
|---------|------|----------|
| Azure Database for PostgreSQL | Managed PG | OLTP |
| Azure Database for MySQL | Managed MySQL | OLTP |
| Azure Cache for Redis | Managed Redis | Caching |
| Azure Synapse | Analytics DW | Big data analytics |

## Cloud Selection Guide

| Need | AWS | GCP | Azure |
|------|-----|-----|-------|
| Managed PostgreSQL | RDS / Aurora | Cloud SQL / AlloyDB | Azure DB for PG |
| Managed MySQL | RDS / Aurora | Cloud SQL | Azure DB for MySQL |
| Serverless relational | Aurora Serverless | Spanner | Azure SQL Serverless |
| Global distribution | Aurora Global / DynamoDB Global | Spanner | Cosmos DB |
| Document NoSQL | DynamoDB / DocumentDB | Firestore | Cosmos DB |
| In-memory cache | ElastiCache | Memorystore | Azure Cache |
| Analytics DW | Redshift | BigQuery | Synapse |
| Time-series | Timestream | Bigtable | Cosmos DB |
| Graph | Neptune | — | Cosmos DB (Gremlin) |

## Migration Strategies

### Approaches
| Strategy | Downtime | Complexity | Use When |
|----------|----------|------------|----------|
| Dump & restore | Hours | Low | Small DBs, acceptable downtime |
| Logical replication | Minutes | Medium | PostgreSQL, need near-zero downtime |
| DMS (AWS) / DMS (Azure) | Minutes | Medium | Cross-engine or cross-cloud |
| Dual-write | Zero | High | Critical systems, gradual cutover |

### AWS DMS (Database Migration Service)
```
Source (on-prem MySQL) → DMS Replication Instance → Target (Aurora PostgreSQL)

# Supports: homogeneous (MySQL→MySQL) and heterogeneous (Oracle→PostgreSQL).
# Full load + CDC (ongoing replication) for minimal downtime.
# Schema Conversion Tool (SCT) for heterogeneous migrations.
```

### Migration Checklist
- [ ] Profile source database (size, throughput, connections).
- [ ] Choose target engine and instance size.
- [ ] Test schema conversion (if cross-engine).
- [ ] Set up replication / DMS task.
- [ ] Validate data integrity (row counts, checksums).
- [ ] Performance test on target.
- [ ] Plan cutover window.
- [ ] Update application connection strings.
- [ ] Monitor post-migration for 48-72 hours.
- [ ] Decommission source after validation period.

## Backup & Disaster Recovery

### RPO / RTO Targets
| Tier | RPO (Data Loss) | RTO (Downtime) | Strategy |
|------|-----------------|----------------|----------|
| Critical | 0 (zero loss) | < 5 min | Synchronous replication, Multi-AZ |
| Important | < 1 hour | < 30 min | Async replication, automated failover |
| Standard | < 24 hours | < 4 hours | Daily backups, manual restore |

### Backup Strategies
| Method | RPO | Speed | Storage Cost |
|--------|-----|-------|-------------|
| Continuous WAL archiving | Seconds | Fast recovery | Higher |
| Automated snapshots | Hours | Fast restore | Medium |
| Logical dumps (pg_dump) | Hours | Slow restore | Lower |
| Cross-region replication | Seconds | Fast failover | Higher |

### Managed Service Backup Features
| Feature | AWS RDS | GCP Cloud SQL | Azure SQL |
|---------|---------|---------------|-----------|
| Auto backups | 35-day retention | 365-day retention | 35-day retention |
| Point-in-time | 5-min granularity | Per-transaction | Per-second |
| Cross-region | Snapshot copy / Global | Cross-region replicas | Geo-replication |
| Snapshot export | S3 | GCS | Blob Storage |
