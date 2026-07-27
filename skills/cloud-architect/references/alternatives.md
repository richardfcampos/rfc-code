# Cloud Alternatives: When Non-AWS Services Win

## Table of Contents

1. [Frontend & Edge Deployment](#frontend--edge-deployment)
2. [Database Alternatives](#database-alternatives)
3. [Authentication](#authentication)
4. [Monitoring & Observability](#monitoring--observability)
5. [CI/CD & DevOps](#cicd--devops)
6. [Specific Service Comparisons](#specific-service-comparisons)

---

## Frontend & Edge Deployment

### Vercel — Best for Next.js deployments

| Factor | AWS (CloudFront + Lambda@Edge) | Vercel |
|--------|-------------------------------|--------|
| Next.js support | Manual setup, complex | First-class, zero-config |
| Deploy speed | Minutes (CI/CD pipeline) | Seconds (git push) |
| Preview deployments | Manual setup | Automatic per PR |
| Edge functions | Lambda@Edge (Node.js, limited) | Edge Runtime (lightweight, fast) |
| Cost at low traffic | Higher (ALB + Lambda + CloudFront) | Free tier generous |
| Cost at high traffic | Can be cheaper with optimization | Can get expensive |
| Infrastructure control | Full | Limited |

**Choose Vercel when**: Next.js frontend, small team, speed of deployment matters, preview environments needed.
**Choose AWS when**: Need full infrastructure control, complex backend, cost optimization at scale, regulatory requirements.

### Cloudflare — Best for edge compute and CDN

| Factor | AWS CloudFront | Cloudflare |
|--------|---------------|------------|
| CDN performance | Good | Generally faster (larger edge network) |
| DDoS protection | Shield Standard (free) + Advanced ($) | Included (all plans) |
| Workers (edge compute) | Lambda@Edge (slow cold starts) | Workers (V8 isolates, fast cold starts) |
| DNS | Route 53 ($0.50/zone) | Free |
| SSL | ACM (free) | Free |
| WAF | AWS WAF (per rule pricing) | Included in Pro plan |
| Cost | Pay per request + data | Generous free tier, predictable pricing |

**Choose Cloudflare when**: Edge-heavy workloads, DDoS protection critical, want bundled DNS+CDN+WAF, cost-sensitive.
**Choose AWS CloudFront when**: Deep AWS integration needed, Lambda@Edge for complex logic, already in AWS ecosystem.

### Cloudflare R2 vs. S3

| Factor | S3 | R2 |
|--------|----|----|
| Storage cost | $0.023/GB | $0.015/GB |
| Egress cost | $0.09/GB | **Free** |
| S3 compatibility | Native | S3-compatible API |
| Lifecycle policies | Full | Basic |
| Event notifications | Lambda, SNS, SQS | Workers (beta) |

**Choose R2 when**: High egress volume (serving files to users), cost is primary concern.
**Choose S3 when**: Need full S3 ecosystem (lifecycle, replication, analytics, event triggers).

---

## Database Alternatives

### Supabase vs. AWS (RDS + Cognito + API Gateway)

| Factor | AWS Stack | Supabase |
|--------|----------|----------|
| Setup time | Hours-days | Minutes |
| PostgreSQL | RDS/Aurora | Managed PostgreSQL |
| Auth | Cognito (complex) | Built-in (simple) |
| Real-time | AppSync or custom WebSocket | Built-in real-time subscriptions |
| Storage | S3 | Built-in (S3-backed) |
| Edge functions | Lambda | Deno-based edge functions |
| Cost (small) | $50-200+/month | Free tier, then $25/month |
| Cost (large) | More predictable at scale | Can get expensive |
| Vendor lock-in | Medium (AWS services) | Low (standard PostgreSQL) |

**Choose Supabase when**: Rapid prototyping, need real-time, small team, PostgreSQL preferred, auth + DB + storage in one.
**Choose AWS when**: Enterprise scale, regulatory requirements, need specific AWS integrations, complex architecture.

### PlanetScale vs. Aurora MySQL

| Factor | Aurora MySQL | PlanetScale |
|--------|-------------|-------------|
| Scaling | Read replicas, vertical | Horizontal sharding, automatic |
| Branching | No | Database branching (like git) |
| Schema changes | Migration files, downtime risk | Non-blocking schema changes |
| Serverless | Aurora Serverless v2 | Built-in serverless |
| Cost (small) | $50+/month minimum | Free tier, then $29/month |
| Vitess-based | No | Yes (battle-tested at YouTube scale) |

**Choose PlanetScale when**: MySQL, need schema branching, want zero-downtime migrations, horizontal scaling.
**Choose Aurora when**: Need PostgreSQL, deep AWS integration, complex transactions, existing AWS ecosystem.

### Neon vs. Aurora Serverless (PostgreSQL)

| Factor | Aurora Serverless v2 | Neon |
|--------|---------------------|------|
| Scale to zero | No (minimum 0.5 ACU) | Yes (true scale to zero) |
| Branching | No | Database branching |
| Cold start | Fast (already running) | Seconds |
| Cost (idle) | ~$43/month minimum | Free (scale to zero) |
| Cost (active) | Competitive at scale | Can be higher at scale |

**Choose Neon when**: Dev/preview environments, need true scale-to-zero, database branching.
**Choose Aurora when**: Production with sustained traffic, need guaranteed low latency.

---

## Authentication

### Clerk / Auth0 vs. Cognito

| Factor | Cognito | Clerk | Auth0 |
|--------|---------|-------|-------|
| Developer experience | Poor (complex, confusing docs) | Excellent | Good |
| UI components | Hosted UI (limited customization) | Beautiful, customizable | Universal Login |
| Social login | Supported | Supported | Supported (most providers) |
| MFA | Supported | Supported | Supported |
| Cost (free tier) | 50K MAU | 10K MAU | 7.5K MAU |
| Cost at scale | Cheapest | More expensive | Most expensive |
| Lock-in | Medium (AWS) | Medium | Medium |
| Enterprise SSO | Federated identities | Built-in | Built-in |

**Choose Cognito when**: Cost is primary concern at scale, deep AWS integration (IAM roles, API Gateway authorizer).
**Choose Clerk when**: Developer experience matters, need beautiful pre-built UI, Next.js project.
**Choose Auth0 when**: Enterprise SSO requirements, complex authorization rules, need Actions/Hooks.

---

## Monitoring & Observability

### Datadog / New Relic vs. CloudWatch

| Factor | CloudWatch + X-Ray | Datadog | New Relic |
|--------|-------------------|---------|-----------|
| AWS integration | Native (best) | Excellent | Good |
| Dashboard quality | Basic | Excellent | Good |
| APM / tracing | X-Ray (limited) | Full APM | Full APM |
| Log management | CloudWatch Logs (expensive at scale) | Powerful, expensive | Included |
| Alerting | Basic | Advanced | Advanced |
| Cost | Included (but logs add up) | Per host + features | Per GB ingested |

**Choose CloudWatch when**: Budget-conscious, simple monitoring needs, all-AWS architecture.
**Choose Datadog when**: Complex microservices, need advanced APM, multi-cloud, team needs great dashboards.

---

## CI/CD & DevOps

### GitHub Actions vs. AWS CodePipeline

| Factor | CodePipeline + CodeBuild | GitHub Actions |
|--------|------------------------|----------------|
| Setup complexity | High | Low |
| GitHub integration | Manual | Native |
| Marketplace/ecosystem | Limited | Vast (thousands of actions) |
| AWS deployment | Native | Via actions (good support) |
| Cost | Build minutes | Free for public repos, minutes for private |

**Choose GitHub Actions when**: Code on GitHub (most teams), want simplicity, need diverse integrations.
**Choose CodePipeline when**: All-AWS, need CodeCommit integration, regulatory requirement to keep CI/CD in AWS.

---

## Specific Service Comparisons

### When to Leave AWS for Specific Services

| Use Case | AWS Service | Better Alternative | Why |
|----------|------------|-------------------|-----|
| Next.js deployment | Amplify / custom | **Vercel** | Zero-config, preview deploys, edge |
| Email sending | SES | **Resend** or **Postmark** | Better DX, templates, analytics |
| CDN + DDoS + WAF bundle | CloudFront + Shield + WAF | **Cloudflare** | All-in-one, cheaper, easier |
| High-egress file serving | S3 + CloudFront | **Cloudflare R2** | Zero egress fees |
| PostgreSQL dev/preview | Aurora Serverless | **Neon** | True scale-to-zero, branching |
| Real-time + auth + DB | AppSync + Cognito + RDS | **Supabase** | All-in-one, much simpler |
| Full-text search (small) | OpenSearch | **Typesense** or **Meilisearch** | Simpler, cheaper for small scale |
| Feature flags | AppConfig | **LaunchDarkly** or **Flagsmith** | Better UI, targeting rules |
| Error tracking | CloudWatch | **Sentry** | Source maps, stack traces, context |

### When AWS Always Wins

| Use Case | Why AWS |
|----------|---------|
| Enterprise compliance (FedRAMP, HIPAA, PCI) | Most certifications, GovCloud |
| Complex networking (VPN, Direct Connect, Transit Gateway) | Unmatched networking capabilities |
| Big data / analytics (EMR, Redshift, Athena, Glue) | Most mature data ecosystem |
| AI/ML training (SageMaker, EC2 GPU instances) | GPU availability, ML tooling |
| IoT at scale (IoT Core, Greengrass) | Most complete IoT platform |
| Hybrid cloud (Outposts, Snow family) | On-premise AWS hardware |
| Serverless ecosystem depth (Lambda + 200+ triggers) | Most event sources |
