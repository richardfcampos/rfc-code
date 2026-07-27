# Cost Optimization Reference

## Table of Contents

1. [Pricing Models](#pricing-models)
2. [Cost Architecture Principles](#cost-architecture-principles)
3. [Service-Specific Cost Strategies](#service-specific-cost-strategies)
4. [Cost Estimation Approach](#cost-estimation-approach)
5. [Cost Monitoring & Governance](#cost-monitoring--governance)

---

## Pricing Models

### Compute Pricing Tiers (cheapest → most expensive per hour)

1. **Spot Instances** — Up to 90% discount, can be interrupted with 2-min notice
   - Use for: batch processing, CI/CD, stateless workers, fault-tolerant workloads
   - Never use for: databases, single-instance apps, user-facing latency-sensitive services

2. **Reserved Instances / Savings Plans** — 30-72% discount, 1 or 3-year commitment
   - **Compute Savings Plans**: Flexible across instance types/regions (recommended)
   - **EC2 Instance Savings Plans**: Locked to instance family (deeper discount)
   - **Reserved Instances**: Locked to specific instance (deepest discount, least flexible)
   - Rule of thumb: commit to Savings Plans once base utilization is predictable (>70% steady)

3. **On-Demand** — Full price, no commitment
   - Use for: variable workloads, short-term projects, development/staging environments

### Serverless vs. Provisioned Break-Even

| Service | Serverless Wins | Provisioned Wins |
|---------|----------------|-----------------|
| Lambda vs. Fargate | < ~1M requests/month or bursty | Sustained >50% utilization |
| Aurora Serverless vs. Aurora | Variable/unpredictable, dev/staging | Sustained production traffic |
| DynamoDB On-Demand vs. Provisioned | Unpredictable, spiky traffic | Predictable, steady reads/writes |
| API Gateway vs. ALB | < ~1B requests/month, need auth/throttling | High volume, simple routing |

---

## Cost Architecture Principles

### 1. Right-Size Everything
- Start small, scale based on actual usage (not projected)
- Use AWS Compute Optimizer recommendations
- Review instance utilization monthly (target >40% average CPU)
- Downsize RDS instances during non-peak hours (if multi-AZ not required)

### 2. Use the Right Tier
- S3: Move infrequent data to IA or Glacier automatically (lifecycle policies)
- EBS: Use gp3 instead of gp2 (20% cheaper, better performance)
- EC2: Use Graviton (ARM) instances (20% cheaper, better performance for most workloads)

### 3. Eliminate Waste
- **Idle resources**: Unused EBS volumes, unattached Elastic IPs, idle load balancers
- **Dev/staging**: Stop or scale down outside business hours
- **Snapshots**: Set retention policies, delete orphaned snapshots
- **NAT Gateway**: $0.045/GB — move high-bandwidth services to public subnets or use VPC endpoints
- **Data transfer**: Minimize cross-AZ and cross-region transfers

### 4. Architect for Cost
- Use CloudFront to reduce origin data transfer costs
- Use VPC endpoints instead of NAT Gateway for AWS service access
- Use S3 for static assets instead of serving from compute
- Use SQS to buffer and batch-process instead of scaling compute for spikes
- Use EventBridge Scheduler instead of always-running cron instances

### 5. Scale by Demand
- Auto Scaling Groups with target tracking (CPU, request count)
- Scheduled scaling for predictable patterns (business hours)
- Lambda concurrency limits to cap costs
- DynamoDB auto-scaling or on-demand for traffic spikes

---

## Service-Specific Cost Strategies

### Compute
| Strategy | Savings |
|----------|---------|
| Graviton (ARM) instances | ~20% |
| Spot for fault-tolerant workloads | Up to 90% |
| Savings Plans (1-year, no upfront) | ~30% |
| Savings Plans (3-year, all upfront) | ~60% |
| Right-sizing (Compute Optimizer) | 10-40% |
| Stop dev/staging off-hours | ~65% |

### Storage
| Strategy | Savings |
|----------|---------|
| S3 Intelligent-Tiering | Automatic, 0-68% |
| S3 lifecycle → Glacier | Up to 95% vs Standard |
| gp3 instead of gp2 | 20% |
| Delete unused EBS volumes/snapshots | 100% of waste |
| Compress data before storing | 50-80% |

### Database
| Strategy | Savings |
|----------|---------|
| Aurora Serverless v2 for dev/staging | Scale to zero |
| Reserved instances for production RDS | 30-60% |
| DynamoDB reserved capacity | 50-75% |
| Read replicas for read-heavy workloads | Reduce primary instance size |
| Optimize queries (reduce IO) | Variable |

### Networking (often the hidden cost)
| Cost Source | Mitigation |
|-------------|-----------|
| NAT Gateway ($0.045/GB) | VPC endpoints, public subnets for stateless services |
| Cross-AZ transfer ($0.01/GB) | Single-AZ for non-critical, or accept cost for HA |
| Cross-region transfer ($0.02/GB) | Keep data in one region when possible |
| CloudFront vs. direct S3 | CloudFront often cheaper for high-traffic static content |
| API Gateway ($3.50/million) | ALB ($0.008/LCU-hour) for internal or high-volume APIs |

---

## Cost Estimation Approach

### For New Projects

1. **Identify components**: List every AWS service the architecture requires
2. **Estimate usage**: Requests/month, data stored, data transferred, compute hours
3. **Calculate per-service**: Use AWS Pricing Calculator or the pricing tables above
4. **Add data transfer**: Often forgotten — include cross-AZ, NAT Gateway, internet egress
5. **Add a buffer**: 20-30% for underestimated usage
6. **Compare architectures**: Cost at 1x, 10x, 100x to understand scaling behavior

### Monthly Cost Sanity Check

| Scale | Typical AWS Bill (web app) |
|-------|---------------------------|
| Hobby / MVP | $5-50 (serverless, free tier) |
| Small startup (< 10K users) | $50-500 |
| Growing (10K-100K users) | $500-5,000 |
| Mid-scale (100K-1M users) | $5,000-50,000 |
| Large scale (1M+ users) | $50,000+ |

---

## Cost Monitoring & Governance

### Essential Setup
1. **AWS Budgets** — Set monthly budget alerts at 50%, 80%, 100%
2. **Cost Explorer** — Review weekly, group by service and tag
3. **Cost Allocation Tags** — Tag everything: `Environment`, `Team`, `Project`
4. **Trusted Advisor** — Review cost optimization recommendations monthly
5. **Compute Optimizer** — Right-sizing recommendations for EC2, Lambda, EBS

### Cost Anomaly Detection
- Enable AWS Cost Anomaly Detection for automatic alerts
- Set up CloudWatch billing alarms as a safety net
- Review unblended costs daily during rapid growth phases

### Governance
- Use AWS Organizations with SCPs to prevent expensive instance types
- Require tags on resource creation (AWS Config rules)
- Use Service Quotas to prevent runaway scaling
- Review and approve architecture changes that increase monthly cost >20%
