# Kubernetes Best Practices

## Table of Contents
- [Workload Resources](#workload-resources)
- [Networking & Services](#networking--services)
- [Storage](#storage)
- [Configuration & Secrets](#configuration--secrets)
- [Scaling & Autoscaling](#scaling--autoscaling)
- [Helm Charts](#helm-charts)
- [Kustomize](#kustomize)
- [Cloud-Managed K8s](#cloud-managed-k8s)
- [Debugging & Troubleshooting](#debugging--troubleshooting)
- [Common Anti-Patterns](#common-anti-patterns)

## Workload Resources

### Production Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  labels:
    app.kubernetes.io/name: app
    app.kubernetes.io/version: "1.2.0"
    app.kubernetes.io/component: backend
spec:
  replicas: 3
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: app
  template:
    metadata:
      labels:
        app.kubernetes.io/name: app
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: app
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      terminationGracePeriodSeconds: 60
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app.kubernetes.io/name: app
                topologyKey: kubernetes.io/hostname
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: app
      containers:
        - name: app
          image: registry.example.com/app@sha256:abc123...
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 512Mi
          env:
            - name: DB_HOST
              valueFrom:
                configMapKeyRef:
                  name: app-config
                  key: db-host
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: app-secrets
                  key: db-password
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /healthz
              port: 8080
            failureThreshold: 30
            periodSeconds: 5
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 100Mi
```

### Pod Disruption Budget
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: app-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: app
```

### CronJobs
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: db-backup
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      activeDeadlineSeconds: 3600
      backoffLimit: 3
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: registry.example.com/db-backup:1.0
              resources:
                requests:
                  cpu: 100m
                  memory: 256Mi
                limits:
                  memory: 512Mi
```

## Networking & Services

### Service Types
```yaml
# ClusterIP (internal — default).
apiVersion: v1
kind: Service
metadata:
  name: app
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: app
  ports:
    - port: 80
      targetPort: 8080

---
# Headless (for StatefulSets / DNS discovery).
apiVersion: v1
kind: Service
metadata:
  name: db-headless
spec:
  clusterIP: None
  selector:
    app.kubernetes.io/name: db
  ports:
    - port: 3306
```

### Ingress with TLS
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts: [app.example.com]
      secretName: app-tls
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app
                port:
                  number: 80
```

### Network Policies
```yaml
# Default deny all ingress.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}
  policyTypes: [Ingress]

---
# Allow only app → database.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-app-to-db
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: db
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: app
      ports:
        - port: 3306
```

## Storage

### PersistentVolumeClaim
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: db-data
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: gp3-encrypted
  resources:
    requests:
      storage: 50Gi
```

### Storage Classes by Cloud
| Cloud | Fast SSD | Standard | Shared |
|-------|----------|----------|--------|
| AWS | `gp3` | `sc1` | EFS (`ReadWriteMany`) |
| GCP | `pd-ssd` | `pd-standard` | Filestore |
| Azure | `managed-premium` | `managed-standard` | Azure Files |

## Configuration & Secrets

### ConfigMap
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  db-host: "db.default.svc.cluster.local"
  log-level: "info"
```

### External Secrets (preferred for production)
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: app-secrets
  data:
    - secretKey: db-password
      remoteRef:
        key: production/app/db
        property: password
```

## Scaling & Autoscaling

### HPA
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: app
  minReplicas: 3
  maxReplicas: 20
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
          value: 25
          periodSeconds: 60
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
```

### VPA
```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: app-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: app
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
      - containerName: app
        minAllowed:
          cpu: 100m
          memory: 128Mi
        maxAllowed:
          cpu: "4"
          memory: 4Gi
```

### KEDA (Event-Driven)
```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: app-scaler
spec:
  scaleTargetRef:
    name: app
  minReplicaCount: 1
  maxReplicaCount: 50
  triggers:
    - type: rabbitmq
      metadata:
        queueName: tasks
        queueLength: "10"
```

## Helm Charts

### Chart Structure
```
chart/
├── Chart.yaml
├── values.yaml
├── values-production.yaml
├── values-staging.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── pdb.yaml
│   └── serviceaccount.yaml
└── tests/
    └── test-connection.yaml
```

### values.yaml Pattern
```yaml
replicaCount: 3

image:
  repository: registry.example.com/app
  tag: ""
  pullPolicy: IfNotPresent

resources:
  requests:
    cpu: 250m
    memory: 256Mi
  limits:
    cpu: "1"
    memory: 512Mi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPU: 70

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: app.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: app-tls
      hosts: [app.example.com]
```

## Kustomize

### Overlay Structure
```
base/
├── kustomization.yaml
├── deployment.yaml
├── service.yaml

overlays/
├── staging/
│   ├── kustomization.yaml
│   └── patches/
└── production/
    ├── kustomization.yaml
    └── patches/
```

### Production Overlay
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
namePrefix: prod-
namespace: production
patches:
  - path: patches/replicas.yaml
  - path: patches/resources.yaml
images:
  - name: registry.example.com/app
    newTag: v1.2.0
```

## Cloud-Managed K8s

| Feature | AWS EKS | GCP GKE | Azure AKS |
|---------|---------|---------|-----------|
| Node mgmt | Managed Node Groups | Autopilot / Standard | System + User pools |
| Pod IAM | IRSA | Workload Identity | Azure AD Pod Identity |
| Ingress | ALB Controller | GKE Ingress | AGIC |
| Volumes | EBS CSI | PD CSI | Azure Disk CSI |
| Secrets | AWS SM + ESO | Secret Manager | Key Vault CSI |
| Scaling | Karpenter / CA | NAP / CA | CA |

## Debugging & Troubleshooting

```bash
# Pod not starting.
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl get events --sort-by=.lastTimestamp

# Resource issues.
kubectl top pods
kubectl top nodes

# Networking.
kubectl exec -it <pod> -- nslookup <service>
kubectl port-forward svc/<service> 8080:80

# Interactive debug container.
kubectl debug -it <pod> --image=nicolaka/netshoot --target=app
```

### CrashLoopBackOff Diagnosis
1. `kubectl logs <pod> --previous` — check previous container's logs.
2. `kubectl describe pod <pod>` — check events and last state.
3. Common causes: missing config/secrets, wrong command, OOM kill, failed probe.
4. OOM check: look for `OOMKilled` in last state.

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| No resource limits | Node starvation, OOM | Set requests AND limits |
| No probes | Traffic to unhealthy pods | Liveness + readiness + startup |
| `:latest` tag | Non-reproducible | Pin by digest or semver |
| Secrets in ConfigMap | Plaintext | Use Secrets + External Secrets |
| Root containers | Escape = node compromise | `runAsNonRoot: true` |
| Single replica | Zero redundancy | ≥2 replicas + PDB |
| No anti-affinity | All pods on one node | Anti-affinity across hosts/zones |
| No network policies | Flat network | Default deny + explicit allow |
| Manual `kubectl apply` | Drift, no audit | GitOps (ArgoCD / Flux) |
