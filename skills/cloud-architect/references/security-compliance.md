# Security & Compliance Reference

## Table of Contents

1. [IAM Best Practices](#iam-best-practices)
2. [Network Security](#network-security)
3. [Data Protection](#data-protection)
4. [Application Security](#application-security)
5. [Compliance Frameworks](#compliance-frameworks)
6. [Security Monitoring](#security-monitoring)
7. [Incident Response](#incident-response)

---

## IAM Best Practices

### Core Principles
- **Least privilege**: Grant minimum permissions required. Start with zero and add.
- **No long-lived credentials**: Use IAM roles, not access keys. Rotate keys if unavoidable.
- **MFA everywhere**: Enforce MFA on all human IAM users, especially root account.
- **Separate accounts**: Use AWS Organizations with separate accounts for prod, staging, dev.

### IAM Policy Patterns

**Service role (Lambda/ECS):** Scope to specific resources
```json
{
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::my-bucket/prefix/*"
}
```

**Deny patterns:** Use SCPs in Organizations to deny dangerous actions
```json
{
  "Effect": "Deny",
  "Action": ["ec2:RunInstances"],
  "Condition": {
    "StringNotEquals": { "ec2:InstanceType": ["t3.micro", "t3.small", "t3.medium"] }
  }
}
```

### Common IAM Mistakes
- Using `*` for resources (scope to specific ARNs)
- Using root account for daily operations
- Sharing IAM users between team members
- Not rotating access keys
- Inline policies instead of managed policies (harder to audit)

---

## Network Security

### VPC Architecture

```
VPC (10.0.0.0/16)
├── Public Subnets (10.0.1.0/24, 10.0.2.0/24)
│   ├── ALB / NLB
│   ├── NAT Gateway
│   └── Bastion host (if needed, prefer SSM Session Manager)
├── Private Subnets (10.0.10.0/24, 10.0.11.0/24)
│   ├── Application servers (ECS, EC2, Lambda in VPC)
│   └── Internal ALB
└── Isolated Subnets (10.0.20.0/24, 10.0.21.0/24)
    └── Databases (RDS, ElastiCache)
```

### Security Groups Rules

| Layer | Inbound | Outbound |
|-------|---------|----------|
| ALB | 443 from 0.0.0.0/0 | App SG on app port |
| App | App port from ALB SG | DB SG on DB port, 443 for AWS APIs |
| DB | DB port from App SG only | None (or minimal) |

**Rules:**
- Never open 0.0.0.0/0 on SSH (22) — use SSM Session Manager
- Reference security groups by ID, not CIDR, for internal traffic
- Keep security groups stateful (no need to open ephemeral ports)
- Use NACLs for subnet-level deny rules (defense in depth)

### Private Connectivity
- **VPC Endpoints (Gateway)**: S3, DynamoDB — free, always use
- **VPC Endpoints (Interface)**: Other AWS services — avoids NAT Gateway costs + exposure
- **PrivateLink**: Expose services to other VPCs without internet
- **Transit Gateway**: Hub-and-spoke for multiple VPCs and on-premise

---

## Data Protection

### Encryption

| Data State | Service | Default |
|-----------|---------|---------|
| S3 at rest | SSE-S3 (default), SSE-KMS, SSE-C | On by default (SSE-S3) |
| EBS at rest | KMS encryption | Enable on all volumes |
| RDS at rest | KMS encryption | Enable at creation |
| DynamoDB at rest | AWS-owned key (default) or CMK | On by default |
| In transit | TLS 1.2+ everywhere | Enforce via policies |

### KMS Best Practices
- Use customer-managed keys (CMKs) for production data
- Enable key rotation (automatic annual rotation)
- Use key policies to control access (not just IAM)
- Separate keys per environment (prod, staging)
- Use key aliases for readability

### Secrets Management
- **Secrets Manager**: Database credentials, API keys, tokens (auto-rotation supported)
- **Parameter Store (SSM)**: Configuration values, non-secret parameters (free for standard)
- **Never**: Hardcode secrets in code, environment variables in task definitions visible in console, or commit to git

---

## Application Security

### API Security Checklist
- [ ] Authentication on all endpoints (Cognito, custom JWT, API keys)
- [ ] Authorization: verify resource ownership, not just authentication
- [ ] Input validation at API boundary (API Gateway request validation or app-level)
- [ ] Rate limiting (API Gateway throttling, WAF rate rules)
- [ ] CORS configured to specific origins (not `*`)
- [ ] Request/response logging for audit trail

### WAF (Web Application Firewall)
- Deploy on CloudFront or ALB
- Enable AWS Managed Rules (core rule set, SQL injection, known bad inputs)
- Add rate-based rules to prevent abuse
- Use custom rules for application-specific patterns
- Monitor WAF metrics and tune to reduce false positives

### DDoS Protection
- **Shield Standard**: Free, automatic L3/L4 protection
- **Shield Advanced**: Paid, DDoS response team, cost protection, L7 protection
- Use CloudFront + WAF as first line of defense
- Enable Route 53 health checks for DNS-level failover

---

## Compliance Frameworks

### SOC 2
- **Scope**: Security, Availability, Processing Integrity, Confidentiality, Privacy
- **AWS requirements**: Encryption at rest/transit, access controls, logging, monitoring
- **Key services**: CloudTrail (audit), Config (compliance), GuardDuty (threat detection)
- **Action**: Enable CloudTrail in all regions, Config rules for resource compliance

### HIPAA
- **Scope**: Protected Health Information (PHI)
- **AWS requirements**: BAA with AWS, encryption, access controls, audit logging
- **Eligible services**: Most major services (check AWS HIPAA eligible list)
- **Action**: Use only HIPAA-eligible services, encrypt everything, log everything

### GDPR
- **Scope**: EU personal data
- **AWS requirements**: Data residency (EU regions), encryption, right to erasure, DPAs
- **Action**: Use eu-west-1 or eu-central-1, implement data deletion workflows, encrypt PII

### PCI DSS
- **Scope**: Cardholder data
- **AWS requirements**: Network segmentation, encryption, access controls, logging
- **Action**: Isolate PCI workloads in dedicated VPC/account, use WAF, tokenize card data

### Common Compliance Setup
1. AWS Organizations with dedicated accounts per compliance boundary
2. CloudTrail enabled in all regions with log file validation
3. AWS Config with conformance packs for the relevant framework
4. GuardDuty enabled in all accounts
5. Security Hub for centralized compliance dashboard

---

## Security Monitoring

### Essential Services (Enable on Day 1)

| Service | Purpose | Cost |
|---------|---------|------|
| **CloudTrail** | API audit logging | Free (1 trail per region) |
| **GuardDuty** | Threat detection (compromised instances, unusual API calls) | Per event volume |
| **Security Hub** | Centralized security findings, compliance checks | Per check + finding |
| **Config** | Resource configuration history, compliance rules | Per rule evaluation |
| **Access Analyzer** | Identify unintended resource sharing | Free |

### Detection Patterns to Monitor
- Root account usage
- Console logins without MFA
- Access keys older than 90 days
- Security group changes (0.0.0.0/0 rules)
- S3 bucket policy changes (public access)
- IAM policy changes
- Unusual API calls from new regions/IPs
- Large data transfers (exfiltration signal)

---

## Incident Response

### Preparation
1. Create an incident response runbook
2. Set up SNS topics for security alerts
3. Configure GuardDuty → EventBridge → SNS for automatic alerts
4. Practice incident response with tabletop exercises

### Response Steps
1. **Detect**: GuardDuty alert, CloudWatch alarm, manual report
2. **Contain**: Isolate affected resources (security group deny-all, revoke credentials)
3. **Investigate**: CloudTrail logs, VPC Flow Logs, application logs
4. **Eradicate**: Remove compromised resources, rotate all credentials
5. **Recover**: Restore from known-good state, verify integrity
6. **Post-mortem**: Document timeline, root cause, remediation actions
