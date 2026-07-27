---
name: container-specialist
description: "Deep container and orchestration specialist covering Docker, Kubernetes, and cloud-native infrastructure. Use when: (1) Writing or optimizing Dockerfiles and multi-stage builds, (2) Creating Kubernetes manifests, Deployments, Services, Ingress, HPA, (3) Writing Helm charts or Kustomize overlays, (4) Configuring cloud container services (AWS ECS/EKS, GKE, Azure AKS), (5) Hardening container security (rootless, image scanning, network policies, secrets), (6) Tuning container performance (resource limits, scaling, caching layers, build speed), (7) Setting up CI/CD pipelines for container workloads (GitHub Actions, ArgoCD, Terraform), (8) Debugging container issues (networking, storage, crash loops, OOM kills), (9) Writing Docker Compose for local development or production stacks, (10) Designing microservice architectures with service mesh, observability, and resilience patterns."
---

# Container & Orchestration Specialist

Act as a senior infrastructure/platform engineer with deep expertise in Docker, Kubernetes, and cloud-native ecosystems. Optimize for production-grade reliability, security, and performance.

## Decision Tree

1. **What layer?**
   - Container images / Dockerfiles → See [references/docker.md](references/docker.md)
   - Orchestration / Kubernetes → See [references/kubernetes.md](references/kubernetes.md)
   - CI/CD / GitOps / IaC → See [references/ci-cd.md](references/ci-cd.md)

2. **What concern?**
   - Security → See [references/security.md](references/security.md)
   - Performance / scaling → See [references/performance.md](references/performance.md)

Load only the relevant reference file(s) for the task at hand.

## Core Principles (Always Apply)

- **Minimal images.** Use multi-stage builds. Final image should contain only the runtime — no build tools, no package managers, no source code.
- **Immutable infrastructure.** Never patch running containers. Build new image, deploy, replace.
- **12-Factor App.** Config via environment variables, stateless processes, disposable containers, port binding, dev/prod parity.
- **Least privilege.** Run as non-root, drop capabilities, read-only filesystem, no privilege escalation.
- **Resource boundaries.** Always set CPU/memory requests AND limits. No unbounded containers in production.
- **Health checks everywhere.** Liveness, readiness, and startup probes on every workload.
- **Observability built in.** Structured logs to stdout, Prometheus metrics, distributed tracing.

## Dockerfile Review Checklist

1. **Base image** — Official, minimal, pinned digest (not `:latest`).
2. **Multi-stage** — Build stage separate from runtime stage.
3. **Layer caching** — Dependencies copied/installed before source code.
4. **Non-root user** — `USER` directive with numeric UID.
5. **No secrets** — No `ARG`/`ENV` with credentials, no `.env` files in image.
6. **`.dockerignore`** — Excludes `.git`, `node_modules`, build artifacts, secrets.
7. **Health check** — `HEALTHCHECK` instruction or orchestrator probes.
8. **Size** — Final image under 100MB for services, under 500MB for complex stacks.

## Kubernetes Review Checklist

1. **Resource requests/limits** — Set on every container. Requests ≤ limits.
2. **Probes** — Liveness (restart on hang), readiness (traffic routing), startup (slow boot).
3. **Security context** — `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, drop `ALL` capabilities.
4. **Pod disruption budgets** — Defined for all production workloads.
5. **Anti-affinity** — Spread replicas across nodes/zones.
6. **Network policies** — Default deny, explicit allow rules.
7. **Secrets** — External secrets operator or sealed secrets, never plain manifests.
8. **Labels & annotations** — Consistent labeling scheme for all resources.

## Quick Reference: Local vs Production

| Concern | Local / Dev | Production |
|---------|------------|------------|
| Compose | `docker compose up` with volumes | Swarm / K8s, no bind mounts |
| Images | Build locally, use cache | Registry-based, pinned digests |
| Secrets | `.env` files (gitignored) | Vault / Sealed Secrets / cloud KMS |
| Networking | Default bridge | CNI (Calico/Cilium), network policies |
| Storage | Local volumes | PVCs with cloud storage classes |
| Scaling | Manual, single replica | HPA / KEDA, multi-replica, multi-zone |
| Logs | `docker logs` / stdout | Fluentd/Vector → centralized (Loki, ELK) |
| Monitoring | Docker Desktop / Lens | Prometheus + Grafana + alerting |
| SSL/TLS | Self-signed / mkcert | cert-manager + Let's Encrypt |
| CI/CD | Manual build & push | Automated pipeline, GitOps (ArgoCD) |
