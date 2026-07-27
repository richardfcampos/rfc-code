# Container Security

## Table of Contents
- [Image Security](#image-security)
- [Runtime Security](#runtime-security)
- [Kubernetes Security](#kubernetes-security)
- [Network Security](#network-security)
- [Secrets Management](#secrets-management)
- [Supply Chain Security](#supply-chain-security)
- [Security Checklist](#security-checklist)

## Image Security

### Base Image Selection
| Priority | Image Type | Size | Attack Surface |
|----------|-----------|------|----------------|
| 1 | Distroless | ~2-20MB | Minimal |
| 2 | Alpine | ~5-50MB | Small |
| 3 | Slim variants | ~50-150MB | Medium |
| 4 | Full OS | ~200-500MB+ | Large — avoid in production |

### Pin Image Versions
```dockerfile
# Bad: mutable.
FROM node:latest

# Good: specific version.
FROM node:22.12-alpine3.20

# Best: pinned by digest (immutable).
FROM node@sha256:abc123def456...
```

### Image Scanning
```bash
# Trivy — comprehensive, free.
trivy image --exit-code 1 --severity CRITICAL,HIGH app:latest

# Grype (Anchore).
grype registry.example.com/app:1.0

# Docker Scout.
docker scout cves registry.example.com/app:1.0
```

## Runtime Security

### Container Security Context
```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
```

### Read-Only Filesystem with Writable Temp
```yaml
containers:
  - name: app
    securityContext:
      readOnlyRootFilesystem: true
    volumeMounts:
      - name: tmp
        mountPath: /tmp
      - name: cache
        mountPath: /app/cache
volumes:
  - name: tmp
    emptyDir: { sizeLimit: 100Mi }
  - name: cache
    emptyDir: { sizeLimit: 200Mi }
```

### Pod Security Standards
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

| Level | Allows | Use For |
|-------|--------|---------|
| `privileged` | Everything | System-level pods only |
| `baseline` | Known safe defaults | General workloads |
| `restricted` | Hardened (recommended) | Production |

## Kubernetes Security

### RBAC (Least Privilege)
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456:role/app-role

---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-role
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["app-secrets"]
    verbs: ["get"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-rolebinding
subjects:
  - kind: ServiceAccount
    name: app
roleRef:
  kind: Role
  name: app-role
  apiGroup: rbac.authorization.k8s.io
```

### Admission Controllers
- **OPA Gatekeeper**: Policy-as-code enforcement.
- **Kyverno**: Kubernetes-native policy engine.
- Use to enforce: resource limits, non-root, image registries, labels.

## Network Security

### Default Deny + Explicit Allow
```yaml
# Deny all.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]

---
# Allow specific traffic.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: app-policy
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: app
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: ingress-nginx
      ports:
        - port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: db
      ports:
        - port: 3306
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - port: 53
          protocol: UDP
```

### mTLS with Service Mesh
```yaml
# Istio — enforce mTLS.
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT
```

## Secrets Management

| Method | Security | Use When |
|--------|----------|----------|
| External Secrets Operator + Vault/AWS SM | Highest | Production |
| Sealed Secrets | High | GitOps workflows |
| K8s Secrets (encrypted at rest) | Medium | Simple clusters |
| ConfigMaps | None | Never for secrets |

### HashiCorp Vault
```yaml
metadata:
  annotations:
    vault.hashicorp.com/agent-inject: "true"
    vault.hashicorp.com/role: "app"
    vault.hashicorp.com/agent-inject-secret-db: "secret/data/production/db"
```

### Sealed Secrets (GitOps-safe)
```bash
kubeseal --format=yaml < secret.yaml > sealed-secret.yaml
# Only the cluster can decrypt. Safe to commit to git.
```

## Supply Chain Security

### Image Signing (Cosign)
```bash
cosign sign --key cosign.key registry.example.com/app:1.0
cosign verify --key cosign.pub registry.example.com/app:1.0
```

### SBOM
```bash
syft registry.example.com/app:1.0 -o spdx-json > sbom.json
grype sbom:sbom.json
```

## Security Checklist

### Image Build
- [ ] Multi-stage build, minimal final image.
- [ ] Base image pinned by digest.
- [ ] No secrets in build args, env, or layers.
- [ ] Image scanned for CVEs.
- [ ] Non-root USER directive.
- [ ] `.dockerignore` excludes sensitive files.

### Kubernetes Runtime
- [ ] `runAsNonRoot: true`.
- [ ] `readOnlyRootFilesystem: true`.
- [ ] `allowPrivilegeEscalation: false`.
- [ ] `capabilities: drop: ["ALL"]`.
- [ ] Resource requests and limits set.
- [ ] Minimal RBAC service account.
- [ ] Pod Security Standard: `restricted`.

### Network
- [ ] Default deny network policies.
- [ ] Explicit allow rules per service.
- [ ] TLS on all external endpoints.
- [ ] mTLS for service-to-service.

### Secrets
- [ ] External secrets operator.
- [ ] Encrypted at rest in etcd.
- [ ] No secrets in git or ConfigMaps.
- [ ] Rotated on schedule.

### Cluster
- [ ] RBAC enabled, least-privilege.
- [ ] Audit logging enabled.
- [ ] Admission controllers enforcing policies.
- [ ] API server not publicly exposed.
