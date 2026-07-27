# Cloud Architecture Patterns

## Table of Contents

1. [Architecture Styles](#architecture-styles)
2. [Serverless Architectures](#serverless-architectures)
3. [Container Architectures](#container-architectures)
4. [Event-Driven Architectures](#event-driven-architectures)
5. [Multi-Tier Web Application](#multi-tier-web-application)
6. [Microservices Patterns](#microservices-patterns)
7. [High Availability & Disaster Recovery](#high-availability--disaster-recovery)
8. [Scaling Patterns](#scaling-patterns)

---

## Architecture Styles

### Decision Matrix

| Factor | Serverless | Containers | EC2/VMs |
|--------|-----------|------------|---------|
| Time to market | Fastest | Fast | Slowest |
| Operational overhead | Lowest | Medium | Highest |
| Cost at low traffic | Lowest (pay per use) | Medium | Highest (always on) |
| Cost at high sustained traffic | Highest | Medium | Lowest |
| Flexibility / control | Lowest | High | Highest |
| Cold start latency | Yes (ms-seconds) | No | No |
| Max execution time | 15 min (Lambda) | Unlimited | Unlimited |
| Team expertise needed | AWS services | Containers + orchestration | Sysadmin + infrastructure |

### Architecture Selection by Scale

```
MVP / Prototype → Serverless (Lambda + API Gateway + DynamoDB)
Startup (product-market fit) → Serverless or App Runner + managed services
Growing (scaling challenges) → ECS Fargate + RDS/Aurora + caching
Scale (cost optimization) → ECS on EC2 + Aurora + ElastiCache + optimization
Enterprise → EKS + multi-account + dedicated networking
```

---

## Serverless Architectures

### API Backend (Most Common)

```
CloudFront → API Gateway → Lambda → DynamoDB / Aurora Serverless
                              ↓
                          S3 (assets)
                              ↓
                      SQS (async tasks) → Lambda (workers)
```

**Best for**: REST/GraphQL APIs, CRUD apps, variable traffic
**Cost profile**: Near-zero at low usage, linear scaling

### Event Processing

```
S3 upload → EventBridge → Lambda → DynamoDB
SNS notification → Lambda → SES (email)
DynamoDB Stream → Lambda → OpenSearch (sync)
Scheduled → EventBridge Rule → Lambda → report generation
```

**Best for**: Reactive workflows, data pipelines, automation

### Full Serverless Stack (Next.js)

```
CloudFront → Lambda@Edge (Next.js SSR)
     ↓
S3 (static assets)
     ↓
API Gateway → Lambda (API routes) → Aurora Serverless v2
                                   → DynamoDB (session/cache)
                                   → S3 (uploads)
```

---

## Container Architectures

### ECS Fargate (Recommended Default)

```
Route 53 → CloudFront → ALB → ECS Fargate (app)
                                    ↓
                            RDS Aurora (database)
                            ElastiCache (cache)
                            S3 (assets)
```

**Best for**: Web apps, APIs, microservices that need >15 min execution or sustained compute

### ECS with Auto Scaling

```
ALB → ECS Service (desired: 2, min: 1, max: 10)
         ↓
  Target Tracking: CPU 60% or Request Count per Target
         ↓
  Fargate Spot (non-critical) + Fargate (baseline)
```

### EKS (When Kubernetes Required)

```
NLB → Ingress Controller → Kubernetes Services → Pods
                                                    ↓
                                            RDS / ElastiCache
```

**Use EKS when**: Team has K8s expertise, need K8s ecosystem (Helm, operators, service mesh), multi-cloud portability required

---

## Event-Driven Architectures

### Async Processing Pattern

```
API → SQS Queue → Lambda/ECS Consumer → Database
         ↓
  Dead Letter Queue (DLQ) → Alert → Manual review
```

**Key decisions:**
- SQS Standard vs. FIFO (ordering vs. throughput)
- Visibility timeout > max processing time
- Always configure a DLQ for failed messages
- Use batch processing (up to 10 messages) for efficiency

### Fan-Out Pattern

```
Service A → SNS Topic → SQS Queue 1 → Consumer 1
                      → SQS Queue 2 → Consumer 2
                      → Lambda 3 (direct)
```

**Use when**: One event triggers multiple independent actions

### Event Bus Pattern

```
Service A → EventBridge ─[rule: order.placed]→ Inventory Lambda
                         ─[rule: order.placed]→ Notification Lambda
                         ─[rule: order.placed]→ Analytics Firehose
Service B → EventBridge ─[rule: user.signup]→ Welcome Lambda
```

**Use when**: Complex event routing, cross-service communication, event replay needed

### Saga Pattern (Distributed Transactions)

```
Step Functions:
  1. Reserve Inventory → success/fail
  2. Charge Payment → success/fail
  3. Create Shipment → success/fail

  On failure at step 3:
  → Compensate: Refund Payment
  → Compensate: Release Inventory
```

**Use when**: Multi-service transactions that need rollback capability

---

## Multi-Tier Web Application

### Standard Production Architecture

```
Route 53 (DNS)
    ↓
CloudFront (CDN + WAF)
    ↓
ALB (HTTPS termination)
    ↓
ECS Fargate / Lambda (application tier)
    ↓
ElastiCache Redis (session + cache)
    ↓
Aurora PostgreSQL (primary database)
    ↓
S3 (object storage, backups)
```

### Network Layout

```
VPC (multi-AZ)
├── Public Subnet AZ-a: ALB, NAT GW
├── Public Subnet AZ-b: ALB, NAT GW
├── Private Subnet AZ-a: App servers
├── Private Subnet AZ-b: App servers
├── Isolated Subnet AZ-a: RDS primary
└── Isolated Subnet AZ-b: RDS replica
```

---

## Microservices Patterns

### When to Use Microservices
- Multiple teams working on different domains
- Services need to scale independently
- Different tech stacks per service make sense
- Deployment independence is critical

### When NOT to Use (Start with Monolith)
- Small team (<5 engineers)
- Unclear domain boundaries
- Startup exploring product-market fit
- Simple CRUD application

### Service Communication

| Pattern | Use When | AWS Service |
|---------|---------|-------------|
| Synchronous (REST/gRPC) | Request-response, low latency | ALB / API Gateway / App Mesh |
| Async messaging | Decoupled, eventual consistency ok | SQS / SNS |
| Event-driven | Multiple consumers, event sourcing | EventBridge / Kinesis |
| Service mesh | Complex service-to-service with observability | App Mesh / EKS + Istio |

### API Gateway Pattern

```
Client → API Gateway → Service A (user)
                     → Service B (order)
                     → Service C (payment)
```

Use API Gateway or ALB path-based routing. Avoid direct service-to-service calls from clients.

---

## High Availability & Disaster Recovery

### HA Tiers

| Tier | SLA | Architecture | Cost Multiplier |
|------|-----|-------------|-----------------|
| Basic | 99% (~3.6 days/year down) | Single AZ, no redundancy | 1x |
| Standard | 99.9% (~8.7 hours/year) | Multi-AZ, auto-scaling | 1.5-2x |
| High | 99.99% (~52 min/year) | Multi-AZ, multi-region read replicas | 2-3x |
| Maximum | 99.999% (~5 min/year) | Active-active multi-region | 3-5x |

### DR Strategies (cheapest → fastest recovery)

1. **Backup & Restore**: S3 cross-region backups, restore when needed. RTO: hours. RPO: last backup.
2. **Pilot Light**: Core services running in DR region at minimal scale. RTO: minutes-hours. RPO: near-zero.
3. **Warm Standby**: Scaled-down copy in DR region. RTO: minutes. RPO: near-zero.
4. **Active-Active**: Full production in both regions. RTO: seconds. RPO: zero.

### Multi-AZ Checklist
- [ ] ALB spans 2+ AZs
- [ ] ECS/EC2 in 2+ AZs with auto-scaling
- [ ] RDS Multi-AZ enabled
- [ ] ElastiCache Multi-AZ with auto-failover
- [ ] NAT Gateway in each AZ (avoid cross-AZ single point of failure)

---

## Scaling Patterns

### Horizontal Scaling
- Add more instances/containers behind a load balancer
- Use auto-scaling with target tracking (CPU, request count, custom metric)
- Ensure application is stateless (use external session store)

### Vertical Scaling
- Increase instance size (CPU, memory)
- Use for databases when horizontal scaling is complex
- Has upper limits — plan for horizontal scaling eventually

### Database Scaling

```
Read-heavy?
  → Read replicas (Aurora up to 15 replicas)
  → ElastiCache for frequently accessed data

Write-heavy?
  → Vertical scaling (larger instance)
  → DynamoDB (horizontal write scaling)
  → Sharding (application-level, last resort for RDS)

Both?
  → CQRS: separate read/write models
  → DynamoDB for writes, Aurora for complex reads
```

### Caching Strategy

```
Client → CloudFront (edge cache, TTL: minutes-hours)
           ↓ (cache miss)
       ALB → App → ElastiCache (application cache, TTL: seconds-minutes)
                      ↓ (cache miss)
                  Database (source of truth)
```

**Cache invalidation**: Use TTL + event-driven invalidation. Never rely solely on TTL for critical data.
