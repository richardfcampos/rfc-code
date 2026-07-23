# RFC Code — production image (T15)
#
# Builds the fork (client + server) and installs the four agent CLIs the
# harness can dispatch sessions to. See deploy/README.md for the verified
# install method per CLI and known gaps.
#
# Build context is the repo root: `docker build -f deploy/Dockerfile ..`
# (docker-compose.yml sets this up via `context: ..`).

# ---------------------------------------------------------------------------
# Stage 1 — build: compile native addons (better-sqlite3, bcrypt, node-pty)
# and produce the client (dist/) + server (dist-server/) bundles.
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# scripts/ is copied alongside the manifest because `npm ci`'s postinstall
# hook (scripts/fix-node-pty.js) requires it to be present; the script itself
# is a no-op on Linux (darwin-only fix), but npm fails the whole install if
# the hook's entry file is missing.
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
    # Drop devDependencies (vite, typescript, electron, eslint, ...) now that
    # the build artifacts (dist/, dist-server/) exist — only production deps
    # need to ship in the runtime stage.
    && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2 — runtime: non-root user, agent CLIs, compiled app only (no
# compiler toolchain, no source tree).
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS runtime

# git: required by the git panel/routes (server/routes/git.js) and project
# clone flow (HUB-11). curl + ca-certificates: required at build time to
# fetch the Cursor CLI installer (no npm package exists for it).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash rfccode

ENV HOME=/home/rfccode
ENV NPM_CONFIG_PREFIX=/home/rfccode/.npm-global
ENV PATH="${NPM_CONFIG_PREFIX}/bin:${HOME}/.local/bin:${PATH}"

USER rfccode
WORKDIR /home/rfccode

# Agent CLIs — install methods verified against each project's own docs
# (2026-07-23), not guessed:
#   - Claude Code (@anthropic-ai/claude-code, npm): provides `claude`.
#   - Codex (@openai/codex, npm): provides `codex`.
#   - OpenCode (opencode-ai, npm): provides `opencode`.
#   - Cursor (cursor-agent): no npm package exists; the official installer
#     script (https://cursor.com/install) is the verified headless method,
#     confirmed non-interactive on Debian bookworm and installs to
#     ~/.local/bin (already on PATH above). If this script ever starts
#     requiring interactive input, Cursor becomes an explicit degradation
#     (HUB-06 AC4) rather than a silent build failure.
RUN npm install -g \
      @anthropic-ai/claude-code \
      @openai/codex \
      opencode-ai \
      --no-audit --no-fund \
    && curl -fsS https://cursor.com/install | bash

WORKDIR /app
USER root

COPY --from=builder --chown=rfccode:rfccode /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=rfccode:rfccode /app/node_modules ./node_modules
COPY --from=builder --chown=rfccode:rfccode /app/dist ./dist
COPY --from=builder --chown=rfccode:rfccode /app/dist-server ./dist-server
COPY --from=builder --chown=rfccode:rfccode /app/public ./public

# Volumes for host-mounted project roots and persistent data (DB + profiles).
# Both are bind-mounted by docker-compose.yml; the mkdir here only ensures
# the non-root user owns the mount points before the first volume attach.
RUN mkdir -p /projects /data && chown rfccode:rfccode /projects /data

USER rfccode

ENV NODE_ENV=production
# AUTH_MODE=trusted requires HOST to be a loopback address (server/middleware/auth.js
# refuses to boot otherwise) — the container must run with `network_mode: host`
# so that loopback address is the deploy host's own loopback (see
# deploy/docker-compose.yml and deploy/README.md for why a bridge `ports:`
# publish cannot satisfy this).
ENV AUTH_MODE=trusted
ENV HOST=127.0.0.1
ENV SERVER_PORT=3001
ENV DATABASE_PATH=/data/db/auth.db
ENV PROFILES_ROOT=/data/profiles

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||3001)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist-server/server/index.js"]
