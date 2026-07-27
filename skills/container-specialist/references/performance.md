# Container Performance Optimization

## Table of Contents
- [Build Performance](#build-performance)
- [Image Optimization](#image-optimization)
- [Resource Management](#resource-management)
- [Scaling Strategies](#scaling-strategies)
- [Networking Performance](#networking-performance)
- [Storage Performance](#storage-performance)
- [Runtime Tuning](#runtime-tuning)
- [Monitoring & Profiling](#monitoring--profiling)

## Build Performance

### Layer Caching
```dockerfile
# Cache-friendly order: dependencies before source.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# BuildKit cache mounts.
RUN --mount=type=cache,target=/root/.npm npm ci
RUN --mount=type=cache,target=/root/.composer/cache composer install
```

### Parallel Multi-Stage Builds
```dockerfile
# Independent stages build simultaneously with BuildKit.
FROM node:22-alpine AS frontend
RUN npm ci && npm run build

FROM composer:2 AS backend
RUN composer install --no-dev

FROM php:8.4-fpm-alpine AS runtime
COPY --from=frontend /app/dist /app/public/build
COPY --from=backend /app /app
```

### Build Speed Tips
| Technique | Impact | How |
|-----------|--------|-----|
| BuildKit | 2-5x faster | `DOCKER_BUILDKIT=1` |
| Cache mounts | 3-10x for deps | `--mount=type=cache` |
| Parallel stages | 2-3x | Independent FROM stages |
| `.dockerignore` | 1-5x less context | Exclude `.git`, `node_modules` |
| Registry cache | Skip rebuild | `cache-from: type=registry` |

### CI/CD Caching
```yaml
# GitHub Actions.
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

## Image Optimization

### Size Comparison
| Strategy | PHP App | Node App | Go App |
|----------|---------|----------|--------|
| Full base | ~500MB | ~350MB | ~300MB |
| Slim | ~200MB | ~150MB | ~100MB |
| Alpine | ~50MB | ~80MB | ~20MB |
| Distroless | ~30MB | ~50MB | ~5MB |
| Scratch | N/A | N/A | ~2MB |

### Reduction Techniques
- Alpine base: 50-90% savings.
- Multi-stage: 60-95% savings.
- `.dockerignore`: exclude build artifacts.
- Chain `RUN` with `&&` + cleanup.
- Strip binaries: `go build -ldflags="-s -w"`.

## Resource Management

### Right-Sizing
```yaml
resources:
  requests:
    cpu: 100m        # Guaranteed minimum.
    memory: 128Mi
  limits:
    cpu: "1"         # Throttled above this.
    memory: 512Mi    # OOM killed above this.
```

### CPU vs Memory Behavior
| Resource | Under-provisioned | Over-provisioned |
|----------|-------------------|------------------|
| CPU requests | Pending pods | Wasted capacity |
| CPU limits | Throttled (slow) | Can't burst |
| Memory requests | OOM target | Wasted capacity |
| Memory limits | OOM killed | Can't grow |

### Tuning Workflow
1. Deploy with generous limits, no CPU limit.
2. Monitor actual usage 7+ days (Prometheus/Grafana).
3. Set requests to P50, limits to P99 + 20% buffer.
4. Use VPA in recommendation mode.
5. Re-evaluate after traffic changes.

### QoS Classes
| QoS | When | Eviction Priority |
|-----|------|-------------------|
| Guaranteed | requests == limits | Last to evict |
| Burstable | requests < limits | Middle |
| BestEffort | No requests/limits | First to evict |

## Scaling Strategies

### HPA Multi-Metric
```yaml
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: 1000
```

### Scaling Behavior
```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 60
    policies:
      - type: Pods
        value: 4
        periodSeconds: 60
  scaleDown:
    stabilizationWindowSeconds: 300
    policies:
      - type: Percent
        value: 10
        periodSeconds: 120
```

### Node Scaling
| Tool | Cloud | Strategy |
|------|-------|----------|
| Cluster Autoscaler | All | Scales on pending pods |
| Karpenter | AWS | Fast, cost-optimized |
| NAP | GKE | GKE-native |

### Pre-Scaling (known events)
```yaml
# KEDA cron trigger.
triggers:
  - type: cron
    metadata:
      timezone: America/New_York
      start: 0 8 * * 1-5
      end: 0 20 * * 1-5
      desiredReplicas: "15"
```

## Networking Performance

### Service Mesh Overhead
| Mesh | Latency | Memory/Sidecar |
|------|---------|----------------|
| Istio (Envoy) | +1-3ms p99 | ~50-100MB |
| Linkerd | +0.5-1ms p99 | ~10-20MB |
| Cilium (eBPF) | ~0ms | ~0MB (no sidecar) |

### DNS Optimization
```yaml
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"    # Default 5 causes 4 extra lookups.
      - name: single-request-reopen
```

## Storage Performance

| Type | IOPS | Latency | Use For |
|------|------|---------|---------|
| Local SSD | Highest | Lowest | Databases, caches |
| io2 (AWS) | Provisioned | Low | Critical databases |
| gp3 (AWS) | 3000 baseline | Low | General |
| EFS/Filestore | Moderate | Higher | Shared read-heavy |

### Ephemeral Storage
```yaml
volumes:
  - name: tmp
    emptyDir:
      medium: Memory     # tmpfs — RAM-backed.
      sizeLimit: 256Mi
  - name: scratch
    emptyDir:
      sizeLimit: 1Gi     # Disk-backed.
```

## Runtime Tuning

### PHP-FPM
```ini
; Match max_children to memory: limit / avg_process_size.
; 512MB limit, ~40MB per process = 12.
pm = static
pm.max_children = 12
pm.max_requests = 1000
access.log = /dev/stdout
```

### Node.js
```dockerfile
# Match to container limit minus overhead.
ENV NODE_OPTIONS="--max-old-space-size=384"
# Container: 512Mi, leave ~128Mi for OS/overhead.
```

### JVM
```dockerfile
ENV JAVA_OPTS="-XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0"
```

### Graceful Shutdown
```yaml
spec:
  terminationGracePeriodSeconds: 60
  containers:
    - lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 5"]
            # Wait for LB to remove pod before shutdown.
```

## Monitoring & Profiling

### Essential Metrics
| Category | Metric | Alert Threshold |
|----------|--------|-----------------|
| CPU | Usage vs limit | >80% sustained |
| Memory | Working set vs limit | >85% |
| Restarts | Restart count | >0 in 5min |
| Network | Dropped packets | >0 |
| Latency | p99 response time | >SLA target |

### Prometheus ServiceMonitor
```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: app
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: app
  endpoints:
    - port: metrics
      interval: 15s
      path: /metrics
```

### Profiling Commands
```bash
kubectl top pods -n production --sort-by=memory
kubectl top nodes
kubectl describe nodes | grep -A 10 "Allocated resources"
```

### Dashboard Methods
- **USE**: Utilization, Saturation, Errors per resource.
- **RED**: Rate, Errors, Duration per service.
- Track: pod restarts, OOM kills, HPA current vs desired.
