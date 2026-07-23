# RFC Code — intel deploy guide

Self-hosted deploy of RFC Code (fork of [CloudCLI UI](https://github.com/siteboon/claudecodeui))
for the `intel` server, reachable only over the Tailscale tailnet (HUB-01,
AD-001/AD-002).

## Prerequisites on intel

- Docker + Docker Compose v2 (`docker compose version`)
- Tailscale installed and logged in on intel (`tailscale status`)
- Two host directories for persistent state (paths are yours to choose):
  - a **projects root** — the parent directory of every project you want
    browsable in the UI
  - a **data root** — holds the SQLite DB and per-profile credential dirs;
    back this up, it is the only stateful thing in the whole deploy

## 1. Configure

```bash
cd deploy
cp .env.example .env   # if you keep one; otherwise export inline (see below)
```

Set these before `up` (env vars, or a `deploy/.env` picked up by Compose):

| Variable | Purpose | Example |
| --- | --- | --- |
| `PROJECTS_ROOT` | host path mounted at `/projects` | `/srv/rfc-code/projects` |
| `DATA_ROOT` | host path mounted at `/data` (DB + profiles) | `/srv/rfc-code/data` |
| `RFC_CODE_PORT` | port the server listens on (loopback only) | `3001` (default) |
| `NOTIFY_URL`, `NOTIFY_TOKEN` | notify-hub webhook (reserved for T18 — safe to leave unset) | — |

**Never** put credentials for Claude/Codex/Cursor/OpenCode in `.env` or the
image — they live only inside `DATA_ROOT/profiles/<provider>/<slug>`,
written by each CLI's own login flow (see step 4).

## 2. Build and start

```bash
PROJECTS_ROOT=/srv/rfc-code/projects DATA_ROOT=/srv/rfc-code/data \
  docker compose up -d --build
```

`docker compose logs -f rfc-code` should show the server binding to
`127.0.0.1:${RFC_CODE_PORT}` and `GET /health` returning `200`.

### Why host networking

This compose file uses `network_mode: host` instead of a bridge `ports:`
publish. `AUTH_MODE=trusted` makes the server refuse to boot unless it binds
a loopback address (`server/middleware/auth.js`) — that guard is the only
thing standing between the app and the network once login is disabled, so it
is intentionally strict. Under standard Docker bridge networking, a process
bound to `127.0.0.1` **inside** the container is unreachable through a
published port — Docker's NAT delivers the packet to the container's bridge
IP, never to its loopback (verified directly: a bridge-published
`127.0.0.1`-bound listener could not be reached from the host with `curl`,
while the same listener under `network_mode: host` could). Host networking
makes the container's loopback the same as intel's own loopback, which is
also exactly what `tailscale serve` expects to proxy from in step 3.

## 3. Expose on the tailnet

```bash
sudo tailscale serve --bg https+insecure://127.0.0.1:${RFC_CODE_PORT}
```

This publishes `https://intel.<your-tailnet>.ts.net/` (or the equivalent
short MagicDNS name) to every device on your tailnet, and only your tailnet
— `intel`'s public interfaces never get a listener for this port (HUB-01
AC2, verified with `network_mode: host` binding `127.0.0.1` only). Confirm:

```bash
tailscale serve status
```

## 4. Log in each account profile

Trusted mode skips the app's own login screen, but each agent CLI still
needs its own OAuth/API-key login per profile:

1. Open the harness at the tailnet URL, go to **Profiles**, create a
   profile per provider/account (HUB-05 AC1).
2. Click **Authenticate** on the profile — this opens the embedded terminal
   web (HUB-11) with that profile's isolated config dir already injected
   into the shell's env, and a suggested command (`claude /login`,
   `codex login`, `cursor-agent login`, `opencode auth login`).
3. Complete the CLI's own OAuth/device flow in that terminal. Credentials
   land under `DATA_ROOT/profiles/<provider>/<slug>` and persist across
   restarts (HUB-05 AC5, HUB-07 AC2).

## 5. Smoke test

```bash
cd deploy
RFC_CODE_PORT=3001 ./smoke-test.sh
```

Checks `docker compose up`, `/health`, `/projects` mount, a restart
preserving a marker profile (DB persistence), and that no process survives
a restart (no zombie sessions). Tailnet-reachability steps require
`TAILSCALE_DOMAIN=intel.<tailnet>.ts.net` and a second, non-tailnet device
— both are marked `[intel-only]` and skipped when run elsewhere.

**Running this on a Mac dev machine (Docker Desktop):** the curl-based
checks will fail even on a correctly-built image — `network_mode: host`
means the container joins Docker Desktop's Linux VM namespace, not
macOS's own, so the host shell's curl cannot reach `127.0.0.1:${RFC_CODE_PORT}`
(verified 2026-07-23: nothing listens on that port from the macOS side,
while `docker exec rfc-code curl -fsS http://127.0.0.1:3001/health` succeeds
from inside the container). This is a Docker Desktop limitation, not a
deploy defect — on intel's native Linux Docker Engine, `network_mode: host`
*is* the host's own network namespace and the script runs end-to-end.
Verify a Mac-built image with `docker exec` instead of the script when
`docker compose exec` is unavailable to the checks.

## Troubleshooting

- **Server refuses to start with "AUTH_MODE=trusted requires HOST to be a
  loopback address"**: `HOST` was overridden to something other than
  `127.0.0.1`/`::1`/`localhost`. Unset any `HOST` override — the image
  already defaults it correctly.
- **`docker compose up` succeeds but the tailnet URL times out**: check
  `network_mode: host` is actually in effect (`docker inspect rfc-code
  --format '{{.HostConfig.NetworkMode}}'` should print `host`) and that
  `tailscale serve` is pointed at the same `RFC_CODE_PORT`.
- **Node/native-module ABI mismatches** (`better-sqlite3`/`bcrypt`/`node-pty`
  failing to load): not applicable to this deploy — the image compiles
  these against the exact `node:22-bookworm` runtime it ships, so there is
  no host Node version to match. If you rebuild against a different base
  image, rebuild the whole image (`docker compose build --no-cache`) rather
  than swapping `node_modules` in place.
- **A CLI reports "not authenticated" after `docker compose restart`**:
  confirm `DATA_ROOT` is the same host path across restarts — a moved or
  ephemeral `DATA_ROOT` loses profile credentials (HUB-07 AC2 depends on a
  stable volume, not on the container).
- **Cursor CLI missing/broken**: the image installs `cursor-agent` via the
  official `https://cursor.com/install` script at build time (no npm
  package exists). If Cursor changes that script to require interactive
  input, `docker build` will fail there — treat Cursor as the explicitly
  degraded agent for this deploy (HUB-06 AC4) rather than patching around a
  vendor script change blind.

## Known gap (not fixed in this phase)

T17 (real intel deploy + multi-device UAT) is operational and requires the
user's tailnet access and real provider accounts — it is not part of this
Docker/Compose delivery.
