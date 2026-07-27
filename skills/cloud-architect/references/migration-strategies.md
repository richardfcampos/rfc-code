# Migration Strategies: Monolith to Cloud

## Table of Contents

1. [Migration Assessment](#migration-assessment)
2. [The 7 R's of Migration](#the-7-rs-of-migration)
3. [Strangler Fig Pattern](#strangler-fig-pattern)
4. [Database Migration](#database-migration)
5. [Migration Phases](#migration-phases)
6. [Risk Mitigation](#risk-mitigation)

---

## Migration Assessment

### Before Migrating, Answer These Questions

1. **What's the business driver?** — Cost reduction, scalability, speed of delivery, compliance?
2. **What's the current architecture?** — Monolithic, modular monolith, partial microservices?
3. **What are the dependencies?** — Database, file system, external APIs, shared state?
4. **What's the team capacity?** — Can they operate cloud infrastructure alongside current system?
5. **What's the risk tolerance?** — Can you afford downtime? Data loss window?

### Migration Readiness Checklist
- [ ] Application inventory complete (services, dependencies, data stores)
- [ ] Performance baseline documented (current metrics to compare against)
- [ ] Compliance requirements identified (data residency, encryption, audit)
- [ ] Team trained on target AWS services
- [ ] Rollback plan defined for each migration phase
- [ ] Cost model estimated for cloud target

---

## The 7 R's of Migration

| Strategy | Description | When to Use | Effort | Risk |
|----------|-------------|-------------|--------|------|
| **Rehost** (Lift & Shift) | Move as-is to EC2/VMs | Quick migration, minimal changes needed | Low | Low |
| **Replatform** (Lift & Reshape) | Minor optimizations (e.g., move DB to RDS) | Quick wins without rewriting | Low-Med | Low |
| **Refactor** (Re-architect) | Redesign for cloud-native | Need scalability, agility | High | Medium |
| **Repurchase** | Replace with SaaS (e.g., CRM → Salesforce) | Better SaaS alternative exists | Medium | Low |
| **Retire** | Decommission unused systems | System is no longer needed | Low | None |
| **Retain** | Keep as-is (not everything needs to move) | Compliance, cost, or complexity makes migration impractical | None | None |
| **Relocate** | Move to cloud without changes (VMware Cloud on AWS) | Existing VMware infrastructure | Low | Low |

### Decision Guide

```
Is the system still needed?
├─ No → Retire
└─ Yes → Is there a better SaaS replacement?
    ├─ Yes → Repurchase
    └─ No → Is it worth migrating?
        ├─ No → Retain
        └─ Yes → How much change is justified?
            ├─ Minimal → Rehost
            ├─ Some optimization → Replatform
            └─ Significant redesign → Refactor
```

---

## Strangler Fig Pattern

The recommended approach for incrementally migrating a monolith. New features go to the cloud; old features are migrated one at a time.

### How It Works

```
Phase 1: Route everything through a proxy
  Client → API Gateway/ALB → Monolith (all traffic)

Phase 2: Extract and redirect one service
  Client → API Gateway/ALB ─/users─→ New User Service (cloud)
                            ─/*──────→ Monolith (everything else)

Phase 3: Continue extracting
  Client → API Gateway/ALB ─/users──→ User Service (cloud)
                            ─/orders─→ Order Service (cloud)
                            ─/*──────→ Monolith (shrinking)

Phase 4: Monolith retired
  Client → API Gateway/ALB → All cloud services
```

### Implementation Steps

1. **Place a proxy in front of the monolith** (ALB or API Gateway with path-based routing)
2. **Identify the first service to extract** — Choose one that is:
   - Well-defined boundary (clear inputs/outputs)
   - High-value (frequently changing or performance bottleneck)
   - Low coupling (minimal dependencies on other monolith parts)
3. **Build the new service in the cloud** — Use cloud-native services
4. **Redirect traffic** — Route specific paths to the new service
5. **Verify and monitor** — Compare behavior and performance against the monolith
6. **Repeat** — Extract the next service

### What to Extract First

| Priority | Characteristic | Example |
|----------|---------------|---------|
| High | Frequently changing feature | User authentication |
| High | Performance bottleneck | Search, image processing |
| High | Independent data domain | Notifications, analytics |
| Medium | New feature (build in cloud from start) | New reporting dashboard |
| Low | Tightly coupled core logic | Order processing deeply tied to inventory |

---

## Database Migration

### Strategies

| Approach | Description | Downtime |
|----------|-------------|----------|
| **AWS DMS (Database Migration Service)** | Continuous replication from source to target | Minimal (seconds during cutover) |
| **Dump and restore** | Export data, import to new database | Hours (depends on size) |
| **Dual-write** | Application writes to both old and new DB | Zero (but complex) |
| **Blue-green with DMS** | Replicate, switch over, verify, cutback if needed | Minutes |

### DMS Migration Steps

1. Create DMS replication instance in the same VPC as target
2. Configure source and target endpoints
3. Create migration task (full load + CDC for ongoing changes)
4. Monitor replication lag
5. When lag is zero, cutover:
   - Stop writes to source
   - Wait for final replication
   - Switch application to target
   - Verify data integrity

### Schema Migration Patterns

| From | To | Considerations |
|------|----|---------------|
| MySQL → Aurora MySQL | Near-identical schema, minimal changes | Easiest path |
| PostgreSQL → Aurora PostgreSQL | Near-identical, check extensions | Easy |
| Oracle → Aurora PostgreSQL | Schema conversion needed, stored proc rewrite | Use AWS SCT |
| SQL Server → Aurora PostgreSQL | Schema conversion, T-SQL to PL/pgSQL | Use AWS SCT |
| MongoDB → DocumentDB | Check compatibility (not 100% MongoDB API) | Test thoroughly |
| On-prem → DynamoDB | Schema redesign (relational → NoSQL) | Significant effort |

---

## Migration Phases

### Phase 1: Foundation (Weeks 1-4)
- Set up AWS accounts (Organizations, SSO)
- Configure networking (VPC, VPN/Direct Connect to on-prem)
- Set up CI/CD pipeline for cloud deployments
- Enable security baseline (CloudTrail, GuardDuty, Config)
- Set up monitoring (CloudWatch, alerting)

### Phase 2: Pilot Migration (Weeks 4-8)
- Migrate one non-critical service using chosen strategy
- Validate performance, security, and cost assumptions
- Document lessons learned
- Refine migration playbook

### Phase 3: Incremental Migration (Weeks 8+)
- Migrate services in priority order (strangler fig)
- Each service: build → test → dark launch → canary → full traffic
- Maintain rollback capability at each step
- Run monolith and cloud services in parallel during transition

### Phase 4: Optimization (Ongoing)
- Decommission monolith components as services move
- Optimize cloud costs (right-sizing, reserved instances)
- Implement cloud-native features (auto-scaling, caching)
- Decommission on-premise infrastructure

---

## Risk Mitigation

### Common Migration Risks

| Risk | Mitigation |
|------|-----------|
| Data loss during migration | Use DMS with CDC, verify row counts, checksums |
| Performance regression | Load test before cutover, maintain baseline metrics |
| Increased latency (network) | Use Direct Connect or VPN, keep services in same region |
| Cost overrun | Set budgets/alerts, right-size from start, monitor daily |
| Team skill gaps | Training before migration, start with simple services |
| Scope creep | Migrate first, optimize later — don't refactor during rehost |

### Rollback Strategy
- **Database**: Keep source DB running and DMS replicating during stabilization period
- **Application**: ALB path routing allows instant traffic switch back to monolith
- **DNS**: Route 53 weighted routing for gradual traffic shifting
- **Timeline**: Maintain rollback capability for at least 2 weeks after each cutover
