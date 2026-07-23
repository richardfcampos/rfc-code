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
cp .env.example .env
```

Set these before `up` (env vars, or a `deploy/.env` picked up by Compose):

| Variable | Purpose | Example |
| --- | --- | --- |
| `PROJECTS_ROOT` | host path mounted at `/projects` | `/srv/rfc-code/projects` |
| `DATA_ROOT` | host path mounted at `/data` (DB + profiles) | `/srv/rfc-code/data` |
| `BIND_IP` | host interface the port is published on | `100.70.101.109` (intel's tailnet IP, default) |
| `PORT` | host port published on `BIND_IP` | `7789` (default) |
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
`0.0.0.0:3001` inside the container and `GET /health` returning `200`. With
the default `BIND_IP`/`PORT`, the service is now reachable at
**`http://intel:7789`** from any device on the tailnet — no `tailscale
serve` step required for plain HTTP access.

### Why bridge networking with a tailnet-only publish

This compose file uses standard Docker bridge networking with an explicit
`ports:` publish, not `network_mode: host`. Host networking does not work on
Docker Desktop for macOS: the container joins Docker Desktop's isolated
Linux VM namespace instead of macOS's own network stack, so nothing
published that way is ever reachable from the host or the tailnet — verified
empirically on the macOS host `intel` (2026-07-23). Bridge networking with a
`ports:` publish does not have that problem on macOS or Linux.

`AUTH_MODE=trusted` makes the server refuse to boot unless its bind address
is safe (`server/middleware/auth.js`, `assertTrustedModeBindIsSafe`) — that
guard is the only thing standing between the app and the network once login
is disabled, so it is intentionally strict. A bridge-networked container
must bind every interface **inside** the container (`HOST=0.0.0.0`) for
Docker's NAT to deliver traffic from the published port at all — a loopback
bind inside the container would make it unreachable through the publish,
the same failure host networking was originally introduced to work around.
`AUTH_TRUSTED_CONTAINER_BIND=1` (set in `docker-compose.yml`) tells the guard
that this container-local bind is expected and that the real exposure
boundary is the `ports:` publish instead — which is restricted to a single
host interface (`BIND_IP`, the tailnet IP by default) rather than
`0.0.0.0`, so the app never gets a listener on the LAN or public internet
(HUB-01 AC2).

## 3. (Optional) HTTPS via `tailscale serve`

The default `BIND_IP=100.70.101.109` publish is already tailnet-only HTTP —
most clients need nothing further. The PWA / service worker feature does
require HTTPS, though (browsers refuse to register a service worker over
plain HTTP for a non-localhost origin). If you need that, keep the raw port
off the tailnet and front it with `tailscale serve` instead:

```bash
# deploy/.env: BIND_IP=127.0.0.1 (raw port stays on loopback only)
sudo tailscale serve --bg https+insecure://127.0.0.1:${PORT:-7789}
```

This publishes `https://intel.<your-tailnet>.ts.net/` (or the equivalent
short MagicDNS name) to every device on your tailnet, and only your tailnet
— `intel`'s public interfaces never get a listener for this port either way
(HUB-01 AC2). Confirm:

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
BIND_IP=100.70.101.109 PORT=7789 ./smoke-test.sh
```

Checks `docker compose up`, `/health`, `/projects` mount, a restart
preserving a marker profile (DB persistence), and that no process survives
a restart (no zombie sessions). Tailnet-reachability steps require
`TAILSCALE_DOMAIN=intel.<tailnet>.ts.net` and a second, non-tailnet device
— both are marked `[intel-only]` and skipped when run elsewhere.

**macOS caveat resolved:** earlier revisions of this deploy used
`network_mode: host`, which does not work on Docker Desktop for macOS (the
container joins Docker Desktop's isolated Linux VM namespace, so the host
shell's curl could never reach the published port). Bridge networking with
an explicit `ports:` publish (this revision) does not have that problem —
the smoke test's curl checks against `${BIND_IP}:${PORT}` work the same way
on macOS and on Linux, verified directly on the macOS host `intel`
(2026-07-23).

## Troubleshooting

- **Server refuses to start with "AUTH_MODE=trusted requires HOST to be a
  loopback address"**: `HOST` was overridden to something other than
  `127.0.0.1`/`::1`/`localhost`/`0.0.0.0`, or `AUTH_TRUSTED_CONTAINER_BIND`
  is unset while `HOST=0.0.0.0` — both must be set together for the
  container-bind contract (`server/middleware/auth.js`). `docker-compose.yml`
  already sets both correctly; don't override `HOST` without also keeping
  `AUTH_TRUSTED_CONTAINER_BIND=1`.
- **`docker compose up` succeeds but `http://intel:${PORT}` times out**:
  confirm the publish is actually bound (`docker compose port rfc-code 3001`
  should print `${BIND_IP}:${PORT}`) and that `BIND_IP` matches an interface
  that actually exists on this host (`tailscale ip -4` for the tailnet IP).
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
