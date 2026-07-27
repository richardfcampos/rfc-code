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
# Debian 13 (trixie, glibc 2.41) rather than bookworm (2.36): the RTK release
# binary for arm64 is linked against glibc 2.39 and there is no static musl
# build for that architecture, so bookworm cannot run it at all. Builder and
# runtime stay on the same distro so native addons are compiled against the
# same libc they run on.
FROM node:22-trixie AS builder

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
FROM node:22-trixie AS runtime

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
#   - claudekit: the CLI the bundled ck-* skills shell out to. Without it those
#     skills load and then fail at their first command, which reads as a broken
#     skill rather than a missing dependency.
RUN npm install -g \
      @anthropic-ai/claude-code \
      @openai/codex \
      opencode-ai \
      claudekit \
      --no-audit --no-fund \
    && curl -fsS https://cursor.com/install | bash

WORKDIR /app
USER root

# RTK (Rust Token Killer) — the binary behind the per-profile command-rewriting
# hook. Installed from the project's own GitHub release: the `rtk` name on npm
# belongs to an unrelated release-management tool, so `npm i -g rtk` installs
# the wrong program entirely.
#
# The asset differs per architecture and there is no linux/amd64 gnu build, so
# amd64 takes the static musl one. TARGETARCH is supplied by BuildKit; hard-
# coding arm64 here would produce an image that cannot run on an x86 host.
# Checksums are pinned so a re-tagged or tampered release fails the build
# instead of silently shipping a different binary.
ARG TARGETARCH
ARG RTK_VERSION=0.43.0
RUN set -eu; \
    case "${TARGETARCH:-arm64}" in \
      arm64) rtk_asset='rtk-aarch64-unknown-linux-gnu.tar.gz'; \
             rtk_sha='5519f7ca12e5c143a609f0d28a0a77b97413a8dce31c2681f1a41c24519a8731' ;; \
      amd64) rtk_asset='rtk-x86_64-unknown-linux-musl.tar.gz'; \
             rtk_sha='ff8a1e7766496e175291a85aeca1dc97c9ff6df33e51e5893d1fbc78fea2a609' ;; \
      *) echo "No RTK build for TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/rtk.tar.gz \
      "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/${rtk_asset}"; \
    echo "${rtk_sha}  /tmp/rtk.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/rtk.tar.gz -C /tmp; \
    install -m 0755 "$(find /tmp -maxdepth 2 -type f -name rtk | head -n 1)" /usr/local/bin/rtk; \
    rm -rf /tmp/rtk.tar.gz; \
    rtk --version

# Caveman plugin — the response-compression hook the per-session level drives.
#
# Claude Code's installed_plugins.json records an absolute installPath, so one
# copy here can be referenced by every profile instead of being duplicated into
# each profile volume. Pinned to a commit: this is a third-party plugin that
# runs on every session start, and tracking a moving branch would let its
# behavior change under an image rebuild.
ARG CAVEMAN_PLUGIN_SHA=655b7d9c5431f822264b7732e9901c5578ac84cf
RUN set -eu; \
    git clone --quiet https://github.com/JuliusBrussee/caveman.git /opt/claude-plugins/caveman; \
    git -C /opt/claude-plugins/caveman checkout --quiet "${CAVEMAN_PLUGIN_SHA}"; \
    rm -rf /opt/claude-plugins/caveman/.git; \
    test -f /opt/claude-plugins/caveman/.claude-plugin/plugin.json

COPY --from=builder --chown=rfccode:rfccode /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=rfccode:rfccode /app/node_modules ./node_modules
COPY --from=builder --chown=rfccode:rfccode /app/dist ./dist
COPY --from=builder --chown=rfccode:rfccode /app/dist-server ./dist-server
COPY --from=builder --chown=rfccode:rfccode /app/public ./public

# Bundled skills live outside /app because they are not application code: each
# profile links the ones it wants into its own config dir, since Claude Code
# only discovers skills under $CLAUDE_CONFIG_DIR/skills and every profile has a
# different one. One read-only copy here, symlinked per profile, instead of
# ~28 MB duplicated into every profile volume.
COPY --from=builder --chown=rfccode:rfccode /app/skills /opt/rfc-code/skills

# A few skills ship their own package.json and are dead on arrival without
# their dependencies installed. Only those with actual dependencies are
# installed — the rest declare nothing but test scripts, and running npm there
# would just add empty directories.
RUN set -eu; \
    for manifest in /opt/rfc-code/skills/*/package.json; do \
      [ -f "$manifest" ] || continue; \
      skill_dir="$(dirname "$manifest")"; \
      if node -e "process.exit(Object.keys(require('$manifest').dependencies||{}).length?0:1)"; then \
        echo "Installing dependencies for $(basename "$skill_dir")"; \
        (cd "$skill_dir" && npm install --omit=dev --no-audit --no-fund); \
      fi; \
    done; \
    chown -R rfccode:rfccode /opt/rfc-code/skills

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
