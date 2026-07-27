# Cloud Architecture Document: [System/Feature Name]

**Author:** [Name]
**Date:** [YYYY-MM-DD]
**Status:** [Draft | In Review | Approved]

---

## 1. Overview

### Business Context
[What business problem does this solve? Who are the users?]

### Requirements

**Functional:**
- [Requirement 1]
- [Requirement 2]

**Non-Functional:**
- Availability: [target SLA, e.g., 99.9%]
- Latency: [target, e.g., p99 < 200ms]
- Throughput: [target, e.g., 1000 RPS]
- Data retention: [target, e.g., 7 years]
- Compliance: [frameworks, e.g., SOC2, HIPAA]

---

## 2. Architecture

### Architecture Diagram

```
[ASCII diagram of the architecture]
```

### Components

| Component | AWS Service | Purpose | Scaling Strategy |
|-----------|------------|---------|-----------------|
| [Name] | [Service] | [Purpose] | [How it scales] |

### Data Flow

```
[Step-by-step data flow through the system]
```

---

## 3. Service Decisions

### [Decision 1: e.g., "Compute Platform"]

**Chosen:** [Service]
**Alternatives considered:** [Other options]
**Rationale:** [Why this choice]
**Trade-offs:** [What we give up]

### [Decision 2: e.g., "Database"]

**Chosen:** [Service]
**Alternatives considered:** [Other options]
**Rationale:** [Why this choice]
**Trade-offs:** [What we give up]

---

## 4. Security

### Network Architecture
[VPC layout, subnets, security groups]

### Authentication & Authorization
[How users/services authenticate, IAM strategy]

### Data Protection
[Encryption at rest/transit, key management]

### Compliance
[Relevant frameworks and how they're addressed]

---

## 5. Cost Estimate

| Service | Configuration | Monthly Cost |
|---------|--------------|-------------|
| [Service] | [Instance/config] | $[amount] |
| **Total** | | **$[total]** |

**Cost optimization opportunities:**
- [Opportunity 1]
- [Opportunity 2]

---

## 6. High Availability & Disaster Recovery

**Target RTO:** [Recovery Time Objective]
**Target RPO:** [Recovery Point Objective]

### HA Strategy
[Multi-AZ, auto-scaling, redundancy]

### DR Strategy
[Backup, replication, failover plan]

### Rollback Plan
[How to revert if deployment fails]

---

## 7. Monitoring & Observability

| Metric | Service | Alert Threshold |
|--------|---------|----------------|
| [Metric] | [CloudWatch/etc.] | [When to alert] |

---

## 8. Open Questions
- [ ] [Question 1]
- [ ] [Question 2]
