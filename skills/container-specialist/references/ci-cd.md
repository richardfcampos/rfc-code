# CI/CD & GitOps for Containers

## Table of Contents
- [GitHub Actions Pipelines](#github-actions-pipelines)
- [ArgoCD GitOps](#argocd-gitops)
- [Terraform for Infrastructure](#terraform-for-infrastructure)
- [Container Registry Workflows](#container-registry-workflows)
- [Deployment Strategies](#deployment-strategies)
- [Multi-Environment Promotion](#multi-environment-promotion)
- [Rollback Patterns](#rollback-patterns)

## GitHub Actions Pipelines

### Production Build & Deploy
```yaml
name: Build and Deploy
on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
      digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=semver,pattern={{version}}
      - id: build
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: true
          sbom: true

  scan:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ needs.build.outputs.image-tag }}
          severity: CRITICAL,HIGH
          exit-code: 1

  deploy-staging:
    needs: [build, scan]
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - run: |
          cd k8s/overlays/staging
          kustomize edit set image app=${{ needs.build.outputs.image-tag }}
          kubectl apply -k .
          kubectl rollout status deployment/app -n staging --timeout=300s

  deploy-production:
    needs: [build, scan, deploy-staging]
    runs-on: ubuntu-latest
    environment: production    # Manual approval gate.
    steps:
      - uses: actions/checkout@v4
      - run: |
          cd k8s/overlays/production
          kustomize edit set image app=${{ needs.build.outputs.image-tag }}
          kubectl apply -k .
          kubectl rollout status deployment/app -n production --timeout=600s
```

## ArgoCD GitOps

### Application
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: app-production
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/k8s-manifests.git
    targetRevision: main
    path: apps/app/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### ApplicationSet (multi-environment)
```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: app
spec:
  generators:
    - list:
        elements:
          - cluster: staging
            url: https://staging.example.com
            path: overlays/staging
          - cluster: production
            url: https://prod.example.com
            path: overlays/production
  template:
    metadata:
      name: app-{{cluster}}
    spec:
      source:
        repoURL: https://github.com/org/k8s-manifests.git
        path: apps/app/{{path}}
      destination:
        server: "{{url}}"
        namespace: "{{cluster}}"
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

### Image Updater
```yaml
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: app=registry.example.com/app
    argocd-image-updater.argoproj.io/app.update-strategy: semver
    argocd-image-updater.argoproj.io/app.semver-constraint: ">=1.0.0"
    argocd-image-updater.argoproj.io/write-back-method: git
```

## Terraform for Infrastructure

### EKS Cluster
```hcl
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "production"
  cluster_version = "1.30"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets

  cluster_endpoint_public_access = false
  enable_irsa = true

  eks_managed_node_groups = {
    general = {
      instance_types = ["m7i.xlarge"]
      min_size       = 3
      max_size       = 10
      desired_size   = 3
    }
    spot = {
      instance_types = ["m7i.xlarge", "m6i.xlarge", "m5.xlarge"]
      capacity_type  = "SPOT"
      min_size       = 0
      max_size       = 20
      taints = [{
        key    = "spot"
        value  = "true"
        effect = "NO_SCHEDULE"
      }]
    }
  }

  cluster_addons = {
    coredns            = { most_recent = true }
    kube-proxy         = { most_recent = true }
    vpc-cni            = { most_recent = true }
    aws-ebs-csi-driver = { most_recent = true }
  }
}
```

### ECR with Lifecycle
```hcl
resource "aws_ecr_repository" "app" {
  name                 = "app"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 30 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v"]
          countType     = "imageCountMoreThan"
          countNumber   = 30
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Remove untagged after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      }
    ]
  })
}
```

## Container Registry Workflows

### Multi-Architecture Builds
```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/app:1.0 \
  --push .
```

### Tagging Strategy
| Tag | Purpose | Mutable |
|-----|---------|---------|
| Git SHA | Traceability | No |
| Semver | Releases | No |
| Branch | Latest branch build | Yes |
| `latest` | Avoid in production | Yes |

## Deployment Strategies

### Rolling Update (default)
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0    # Zero-downtime.
```

### Blue-Green
```yaml
# Two deployments, switch Service selector.
# app-blue (current) + app-green (new).
# Service selector: version: blue → switch to green after validation.
```

### Canary (Argo Rollouts)
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: app
spec:
  replicas: 10
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: { duration: 5m }
        - setWeight: 30
        - pause: { duration: 5m }
        - setWeight: 60
        - pause: { duration: 5m }
      analysis:
        templates:
          - templateName: success-rate
        startingStep: 2
```

### Auto-Rollback on Metrics
```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  metrics:
    - name: success-rate
      interval: 1m
      successCondition: result[0] > 0.95
      failureLimit: 3
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",status=~"2.."}[5m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[5m]))
```

## Multi-Environment Promotion

### GitOps Flow
```
feature → staging (auto-deploy) → production (manual approval)

k8s-manifests/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── kustomization.yaml
├── overlays/
│   ├── staging/
│   │   └── kustomization.yaml
│   └── production/
│       └── kustomization.yaml
```

### Promotion Script
```bash
#!/bin/bash
STAGING_IMAGE=$(kubectl get deployment app -n staging \
  -o jsonpath='{.spec.template.spec.containers[0].image}')

cd k8s/overlays/production
kustomize edit set image "app=$STAGING_IMAGE"
git add . && git commit -m "promote: $STAGING_IMAGE to production"
git push
# ArgoCD auto-syncs.
```

## Rollback Patterns

### Kubernetes Native
```bash
kubectl rollout history deployment/app -n production
kubectl rollout undo deployment/app -n production
kubectl rollout undo deployment/app --to-revision=3
```

### ArgoCD
```bash
argocd app history app-production
argocd app rollback app-production <revision>
```

### GitOps Rollback (preferred)
```bash
git revert HEAD && git push
# ArgoCD auto-syncs the reverted state.
```
