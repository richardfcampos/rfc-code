# AWS Service Selection Guide

## Table of Contents

1. [Compute](#compute)
2. [Storage](#storage)
3. [Database](#database)
4. [Messaging & Events](#messaging--events)
5. [Networking](#networking)
6. [Containers & Orchestration](#containers--orchestration)
7. [Serverless](#serverless)
8. [Caching](#caching)
9. [Search & Analytics](#search--analytics)
10. [AI/ML](#aiml)
11. [Monitoring & Observability](#monitoring--observability)

---

## Compute

| Service | When to Use | When NOT to Use | Pricing Model |
|---------|------------|-----------------|---------------|
| **EC2** | Full OS control, GPU workloads, legacy apps, sustained compute | Short-lived tasks, simple web APIs | On-demand, Reserved, Spot, Savings Plans |
| **Lambda** | Event-driven, <15 min execution, sporadic traffic, glue logic | Long-running processes, high-throughput sustained compute | Per-request + duration (GB-s) |
| **Fargate** | Containerized workloads without managing servers | Cost-sensitive sustained workloads (EC2 cheaper), GPU needs | Per vCPU/hr + memory/hr |
| **App Runner** | Simple containerized web apps, fast deploys | Complex networking, fine-grained control | Per vCPU/hr + memory/hr (active + paused) |
| **Lightsail** | Small apps, simple VPS replacement, predictable pricing | Production at scale, complex architectures | Fixed monthly |

### Compute Decision Tree

```
Need GPU? → EC2 (P/G instances)
Event-driven, < 15 min? → Lambda
Containers, no server mgmt? → Fargate (complex) or App Runner (simple)
Full OS control needed? → EC2
Simple web app, predictable cost? → Lightsail
```

---

## Storage

| Service | When to Use | When NOT to Use | Pricing Model |
|---------|------------|-----------------|---------------|
| **S3** | Object storage, static assets, backups, data lake | File system access, low-latency random reads | Per GB stored + requests |
| **EBS** | Block storage for EC2, databases, boot volumes | Shared across instances (use EFS), object storage | Per GB/month + IOPS |
| **EFS** | Shared file system across instances, container storage | Single-instance storage (EBS cheaper), object storage | Per GB/month (higher than EBS) |
| **S3 Glacier** | Long-term archival, compliance retention | Frequent access (retrieval is slow + costly) | Very low storage, high retrieval |

### Storage Tiers (S3)

```
Frequent access → S3 Standard
Infrequent but fast when needed → S3 Standard-IA
Unpredictable access patterns → S3 Intelligent-Tiering
Archive (minutes retrieval) → S3 Glacier Instant Retrieval
Archive (hours retrieval) → S3 Glacier Flexible Retrieval
Archive (12+ hours ok) → S3 Glacier Deep Archive
```

---

## Database

| Service | When to Use | When NOT to Use | Pricing Model |
|---------|------------|-----------------|---------------|
| **RDS (PostgreSQL/MySQL)** | Relational data, ACID transactions, complex queries | Massive scale writes, key-value only | Instance hours + storage |
| **Aurora** | RDS but need higher performance/availability | Cost-sensitive simple apps (RDS cheaper) | Instance hours + IO + storage |
| **Aurora Serverless v2** | Variable/unpredictable relational workloads | Sustained high traffic (provisioned cheaper) | ACU-hours (scales to zero) |
| **DynamoDB** | Key-value/document, massive scale, single-digit ms latency | Complex joins, ad-hoc queries, relational data | On-demand (per request) or Provisioned (capacity units) |
| **ElastiCache (Redis)** | Session store, caching, leaderboards, pub/sub | Primary datastore, complex queries | Node hours |
| **DocumentDB** | MongoDB-compatible, managed document DB | True MongoDB features (use Atlas), simple key-value | Instance hours + IO + storage |
| **Neptune** | Graph data, social networks, recommendation engines | Tabular data, simple lookups | Instance hours + IO |
| **Redshift** | Data warehousing, OLAP, large analytical queries | OLTP, real-time applications | Node hours or Serverless RPU |
| **Timestream** | Time-series data (IoT, metrics, logs) | General-purpose queries | Writes + storage + queries |

### Database Decision Tree

```
Relational + ACID needed?
  ├─ Variable traffic → Aurora Serverless v2
  ├─ High availability critical → Aurora
  └─ Standard workload → RDS PostgreSQL

Key-value or document?
  ├─ Massive scale, simple access patterns → DynamoDB
  └─ MongoDB compatibility needed → DocumentDB

Analytics / warehousing? → Redshift
Graph relationships? → Neptune
Time-series? → Timestream
Caching layer? → ElastiCache Redis
```

---

## Messaging & Events

| Service | When to Use | When NOT to Use | Pricing Model |
|---------|------------|-----------------|---------------|
| **SQS** | Decoupled async processing, task queues, buffering | Real-time fan-out, event routing | Per request |
| **SNS** | Fan-out notifications, pub/sub, push to multiple subscribers | Message queuing, ordering guarantees | Per publish + delivery |
| **EventBridge** | Event-driven architecture, cross-service routing, event rules | Simple point-to-point queuing (SQS cheaper) | Per event |
| **Kinesis Data Streams** | Real-time streaming, ordered data, high throughput | Simple async tasks (SQS), low volume events | Shard hours + data volume |
| **Step Functions** | Orchestrate multi-step workflows, error handling, retries | Simple async tasks, high-frequency short tasks | Per state transition |

### Messaging Decision Tree

```
Point-to-point async queue? → SQS
One event → many subscribers? → SNS
Route events by rules/patterns? → EventBridge
Real-time streaming + ordering? → Kinesis
Multi-step workflow orchestration? → Step Functions
```

---

## Networking

| Service | When to Use | Pricing Consideration |
|---------|------------|----------------------|
| **VPC** | Network isolation (always use) | Free for VPC itself |
| **ALB** | HTTP/HTTPS load balancing, path/host routing | Per hour + LCU |
| **NLB** | TCP/UDP, extreme performance, static IPs | Per hour + LCU (cheaper than ALB per connection) |
| **CloudFront** | CDN, static assets, API caching, edge compute | Per request + data transfer (saves on origin costs) |
| **Route 53** | DNS, domain registration, health checks | Per hosted zone + queries |
| **API Gateway** | REST/WebSocket APIs, throttling, auth integration | Per request (REST) or connection-hours (WebSocket) |
| **PrivateLink / VPC Endpoints** | Private access to AWS services without internet | Per hour + data processed |
| **Transit Gateway** | Connect multiple VPCs and on-premise networks | Per attachment + data processed |

---

## Containers & Orchestration

| Service | When to Use | When NOT to Use |
|---------|------------|-----------------|
| **ECS + Fargate** | Managed containers, no cluster management | Need full Kubernetes API |
| **ECS + EC2** | Cost-sensitive sustained container workloads | Don't want to manage EC2 instances |
| **EKS** | Kubernetes required (team expertise, multi-cloud portability) | Simple apps (ECS simpler + cheaper) |
| **ECR** | Container image registry (always use with ECS/EKS) | — |

### Container Decision

```
Need Kubernetes API/ecosystem? → EKS
Simple container orchestration?
  ├─ Variable/bursty traffic → ECS + Fargate
  └─ Sustained traffic, cost-sensitive → ECS + EC2
```

---

## Serverless

### Lambda Best Practices
- Keep functions focused (single responsibility)
- Minimize cold starts: small packages, provisioned concurrency for latency-sensitive
- Use Lambda layers for shared code/dependencies
- Set memory based on workload (CPU scales with memory)
- Use reserved concurrency to prevent runaway costs

### When Serverless Wins
- Sporadic/unpredictable traffic (pay per use)
- Event-driven processing (S3 triggers, SQS, DynamoDB streams)
- API backends with variable load
- Scheduled tasks (cron via EventBridge)

### When Serverless Loses
- Sustained high-throughput compute (containers/EC2 cheaper)
- Long-running processes (>15 min Lambda limit)
- Workloads needing local state or GPUs
- Latency-critical paths (cold start penalty)

---

## Caching

| Service | When to Use | Pricing |
|---------|------------|---------|
| **ElastiCache Redis** | Application caching, session store, pub/sub | Node hours |
| **DAX** | DynamoDB-specific caching (microsecond reads) | Node hours |
| **CloudFront** | Static/API response caching at edge | Request + data |
| **API Gateway caching** | REST API response caching | Cache size/hour |

---

## Search & Analytics

| Service | When to Use |
|---------|------------|
| **OpenSearch** | Full-text search, log analytics, dashboards |
| **Athena** | Serverless SQL queries on S3 data |
| **Redshift** | Managed data warehouse, complex OLAP |
| **QuickSight** | BI dashboards, embedded analytics |
| **Glue** | ETL, data catalog, data preparation |

---

## AI/ML

| Service | When to Use |
|---------|------------|
| **Bedrock** | Foundation models (Claude, Titan), RAG, agents |
| **SageMaker** | Custom ML model training and deployment |
| **Comprehend** | NLP: sentiment, entities, key phrases |
| **Rekognition** | Image/video analysis, face detection |
| **Transcribe** | Speech-to-text |
| **Polly** | Text-to-speech |
| **Textract** | OCR, document parsing |

---

## Monitoring & Observability

| Service | When to Use |
|---------|------------|
| **CloudWatch** | Default metrics, logs, alarms (always use) |
| **X-Ray** | Distributed tracing across services |
| **CloudTrail** | API audit logging, compliance |
| **Config** | Resource configuration tracking, compliance rules |
| **Trusted Advisor** | Cost optimization, security, performance recommendations |
