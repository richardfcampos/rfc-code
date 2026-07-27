# Docker Best Practices

## Table of Contents
- [Dockerfile Patterns](#dockerfile-patterns)
- [Multi-Stage Builds](#multi-stage-builds)
- [Layer Caching Strategy](#layer-caching-strategy)
- [Image Size Optimization](#image-size-optimization)
- [Docker Compose](#docker-compose)
- [Networking](#networking)
- [Storage & Volumes](#storage--volumes)
- [BuildKit & Build Optimization](#buildkit--build-optimization)
- [Common Anti-Patterns](#common-anti-patterns)

## Dockerfile Patterns

### Production PHP/Nginx
```dockerfile
# syntax=docker/dockerfile:1

# ── Build stage ──
FROM composer:2 AS composer-deps
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist
COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative

# ── Asset build stage ──
FROM node:22-alpine AS assets
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

# ── Runtime stage ──
FROM php:8.4-fpm-alpine AS runtime

RUN apk add --no-cache icu-libs libzip \
    && docker-php-ext-install intl opcache pdo_mysql zip

RUN { \
    echo 'opcache.enable=1'; \
    echo 'opcache.memory_consumption=256'; \
    echo 'opcache.max_accelerated_files=20000'; \
    echo 'opcache.validate_timestamps=0'; \
    echo 'opcache.jit=1255'; \
    echo 'opcache.jit_buffer_size=128M'; \
} > /usr/local/etc/php/conf.d/opcache.ini

RUN addgroup -g 1000 app && adduser -u 1000 -G app -s /bin/sh -D app
WORKDIR /app

COPY --from=composer-deps --chown=app:app /app/vendor ./vendor
COPY --from=assets --chown=app:app /app/build ./build
COPY --chown=app:app . .

USER 1000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD php-fpm-healthcheck || exit 1
EXPOSE 9000
CMD ["php-fpm"]
```

### Production Node.js
```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

USER 1001
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:3000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
```

### Distroless (maximum security)
```dockerfile
FROM golang:1.23 AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /server /server
USER nonroot:nonroot
ENTRYPOINT ["/server"]
```

## Multi-Stage Builds

### Build → Test → Runtime
```dockerfile
FROM base AS build
# Build artifacts.

FROM build AS test
RUN npm test    # Fails = image not built.

FROM runtime AS final
COPY --from=build /app/dist ./dist
```

### Dev + Prod from Same Dockerfile
```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS development
RUN npm install
COPY . .
CMD ["npm", "run", "dev"]

FROM base AS production
RUN npm ci --production
COPY . .
RUN npm run build
CMD ["node", "dist/server.js"]
```

Target selection: `docker build --target production -t app:prod .`

## Layer Caching Strategy

### Order: least-changing first
```dockerfile
# 1. Base image (rarely changes).
FROM php:8.4-fpm-alpine
# 2. System deps (changes with new extensions).
RUN apk add --no-cache libzip icu-libs
# 3. PHP extensions (changes rarely).
RUN docker-php-ext-install opcache pdo_mysql zip intl
# 4. Composer deps (changes when lockfile changes).
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts
# 5. Source code (changes most frequently — last).
COPY . .
RUN composer dump-autoload --optimize
```

### Cache Mounts (BuildKit)
```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y libpq-dev
RUN --mount=type=cache,target=/root/.composer/cache \
    composer install --no-dev
RUN --mount=type=cache,target=/root/.npm \
    npm ci
```

## Image Size Optimization

| Technique | Savings | Example |
|-----------|---------|---------|
| Alpine base | 50-90% | `php:8.4-fpm-alpine` (50MB vs 500MB) |
| Multi-stage | 60-95% | Copy only runtime artifacts |
| Distroless | 70-95% | `gcr.io/distroless/static` (~2MB) |
| `.dockerignore` | Variable | Exclude `.git`, `node_modules`, tests |
| Minimize layers | 5-20% | Chain `RUN` commands with `&&` |
| Strip binaries | 10-30% | `go build -ldflags="-s -w"` |

### Essential `.dockerignore`
```
.git
.github
.env*
node_modules
vendor
tests
docs
*.md
docker-compose*.yml
.vscode
.idea
```

## Docker Compose

### Production-Ready
```yaml
services:
  app:
    image: registry.example.com/app:${TAG:-latest}
    restart: unless-stopped
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    networks:
      - frontend
      - backend
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  db:
    image: mysql:8.4
    restart: unless-stopped
    volumes:
      - db_data:/var/lib/mysql
    environment:
      MYSQL_ROOT_PASSWORD_FILE: /run/secrets/db_root_password
    secrets:
      - db_root_password
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    deploy:
      resources:
        limits:
          memory: 300M

volumes:
  db_data:

networks:
  frontend:
  backend:
    internal: true

secrets:
  db_root_password:
    file: ./secrets/db_root_password.txt
```

### Dev Compose with Hot Reload
```yaml
services:
  app:
    build:
      context: .
      target: development
    volumes:
      - .:/app:cached
      - /app/node_modules
    ports:
      - "3000:3000"
      - "9229:9229"    # Debug port.
    command: npm run dev
```

## Networking

### Network Isolation
```yaml
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true    # No external access.

services:
  nginx:
    networks: [frontend]
  app:
    networks: [frontend, backend]
  db:
    networks: [backend]    # Only reachable from app.
```

- Containers on same network resolve by service name.
- Use service names, not IPs: `mysql://db:3306`.

## Storage & Volumes

| Type | Use Case | Performance |
|------|----------|-------------|
| Named volume | Persistent data (DB, uploads) | Native |
| Bind mount | Development hot reload | Host-dependent |
| tmpfs | Ephemeral scratch data, secrets | RAM speed |

## BuildKit & Build Optimization

```bash
export DOCKER_BUILDKIT=1
```

### Parallel Builds
```dockerfile
# Independent stages build in parallel automatically.
FROM node:22 AS frontend
RUN npm ci && npm run build

FROM maven:3.9 AS backend
RUN mvn package -DskipTests

FROM nginx:alpine AS runtime
COPY --from=frontend /dist /usr/share/nginx/html
COPY --from=backend /target/app.jar /app/
```

### Build Secrets (never stored in layer)
```dockerfile
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
```
```bash
docker build --secret id=npm_token,src=.npmrc .
```

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| `FROM ubuntu:latest` | Unpinned, huge | `FROM alpine:3.20` or distroless |
| `COPY . .` before deps | Busts cache on every code change | Copy lockfiles first, install, then copy code |
| Secrets in `ENV`/`ARG` | Visible in image history | Use `--mount=type=secret` |
| Running as root | Container escape = host root | `USER 1000` |
| No `.dockerignore` | `.git` and `node_modules` in image | Always create `.dockerignore` |
| `:latest` tag | Non-reproducible builds | Pin with digest or semver |
| No health check | Orchestrator can't detect failures | Add `HEALTHCHECK` or K8s probes |
| Fat final image | Build tools in production | Multi-stage builds |
