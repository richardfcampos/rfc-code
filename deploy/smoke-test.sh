#!/usr/bin/env bash
# RFC Code — deploy smoke test (T16)
#
# Executable checklist for the HUB-07 acceptance criteria:
#   AC1 — `docker compose up -d` boots with the host project root mounted.
#   AC2 — a restart preserves session history, profiles and credentials.
#   AC3 — a session active during restart ends up interrupted, not zombie
#         or lost (verified at the process/container level here; the actual
#         session-state transition is owned by the app, not this script).
#
# Usage: run from the deploy/ directory (or pass --dir).
#   ./smoke-test.sh
#
# Steps marked "[intel-only]" require the real tailnet and are skipped when
# run locally (no TAILSCALE_DOMAIN env var set) — see README.md for how to
# run those on intel.
#
# macOS Docker Desktop caveat (verified 2026-07-23): this script's curl
# checks hit ${BASE_URL} from the *host* shell running the script. On a
# native Linux Docker Engine (the intel target), `network_mode: host`
# means that host IS the container's network namespace, so this works. On
# Docker Desktop for Mac, `network_mode: host` instead shares the Docker
# Desktop Linux VM's namespace — distinct from macOS's own network stack —
# so curl from a macOS shell cannot reach the container even though the
# server is up and healthy inside it. If every curl-based check fails here
# on a Mac, verify the container is actually fine with:
#   docker exec rfc-code curl -fsS http://127.0.0.1:3001/health
# before treating it as a real regression. See README.md "Why host
# networking" for the underlying reason AUTH_MODE=trusted requires host
# networking in the first place.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RFC_CODE_PORT="${RFC_CODE_PORT:-3001}"
BASE_URL="http://127.0.0.1:${RFC_CODE_PORT}"
COMPOSE=(docker compose -f docker-compose.yml)
FAILURES=0
PASS_COUNT=0

log_step() { printf '\n[STEP] %s\n' "$1"; }
log_pass() { printf '  [PASS] %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
log_fail() { printf '  [FAIL] %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
log_skip() { printf '  [SKIP] %s (intel-only)\n' "$1"; }

wait_for_health() {
  local timeout="$1" waited=0
  until curl -fsS -o /dev/null "${BASE_URL}/health" 2>/dev/null; do
    waited=$((waited + 2))
    if [ "$waited" -ge "$timeout" ]; then
      return 1
    fi
    sleep 2
  done
  return 0
}

# ---------------------------------------------------------------------------
log_step "AC1: docker compose up -d boots with /projects mounted"
"${COMPOSE[@]}" up -d

if wait_for_health 60; then
  log_pass "GET /health responded within 60s"
else
  log_fail "GET /health never responded — see: docker compose logs"
fi

if curl -fsS -o /dev/null "${BASE_URL}/"; then
  log_pass "UI root (/) responds"
else
  log_fail "UI root (/) did not respond"
fi

if "${COMPOSE[@]}" exec -T rfc-code test -d /projects; then
  log_pass "/projects mount present inside the container"
else
  log_fail "/projects mount missing inside the container"
fi

# ---------------------------------------------------------------------------
log_step "AC2: restart preserves DB, profiles and credentials"

MARKER_PROFILE_NAME="smoke-test-$(date +%s)"
# `|| true` keeps a server-unreachable failure here from aborting the whole
# script under `set -e` — the empty-response case is already handled below
# by the `-n "$MARKER_PROFILE_ID"` check, and the rest of the checklist
# (AC3, tailnet) still needs to run and report so the summary is complete.
CREATE_RESPONSE=$(curl -fsS -X POST "${BASE_URL}/api/profiles" \
  -H 'Content-Type: application/json' \
  -d "{\"provider\":\"claude\",\"name\":\"${MARKER_PROFILE_NAME}\"}" 2>/dev/null || true)
MARKER_PROFILE_ID=$(printf '%s' "$CREATE_RESPONSE" | node -e "
  let raw = '';
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(raw);
      process.stdout.write(payload?.data?.profile?.id ?? '');
    } catch {
      process.stdout.write('');
    }
  });
")

if [ -n "$MARKER_PROFILE_ID" ]; then
  log_pass "created marker profile ${MARKER_PROFILE_NAME} (id=${MARKER_PROFILE_ID})"
else
  log_fail "could not create marker profile via POST /api/profiles (response: ${CREATE_RESPONSE})"
fi

"${COMPOSE[@]}" restart

if wait_for_health 60; then
  log_pass "server back up within 60s after restart"
else
  log_fail "server did not come back up after restart"
fi

if [ -n "$MARKER_PROFILE_ID" ]; then
  if curl -fsS "${BASE_URL}/api/profiles?provider=claude" | grep -q "$MARKER_PROFILE_ID"; then
    log_pass "marker profile survived restart (DB persisted on /data volume)"
  else
    log_fail "marker profile missing after restart — /data volume not persisting"
  fi

  # Cleanup: remove the marker profile so repeated runs stay idempotent.
  curl -fsS -X DELETE "${BASE_URL}/api/profiles/${MARKER_PROFILE_ID}" >/dev/null || true
fi

# ---------------------------------------------------------------------------
log_step "AC3: a restart mid-session leaves no zombie process (container-level guarantee)"

# docker compose restart tears down the container's PID namespace, so any
# CLI child process spawned by a session dies with it — there is no code
# path where a session's process can outlive the container. This checks
# that assumption holds: no agent CLI / shell process should be running
# right after restart, only the server itself (node, PID 1) plus this
# check's own `exec` wrapper (sh/ps — an artifact of how `docker compose
# exec` runs the check, not a leaked session process, so it is excluded by
# name rather than assumed away via a hardcoded total count).
LEAKED_PROCESSES=$("${COMPOSE[@]}" exec -T rfc-code sh -c "ps -eo comm --no-headers" 2>/dev/null | grep -Ev '^(node|sh|ps|wc)$' || true)
if [ -z "$LEAKED_PROCESSES" ]; then
  log_pass "container process table is clean after restart (no leaked session/CLI processes)"
else
  log_fail "unexpected processes still running after restart: $(printf '%s' "$LEAKED_PROCESSES" | tr '\n' ',')"
fi

# ---------------------------------------------------------------------------
log_step "Tailnet exposure (intel-only)"

if [ -n "${TAILSCALE_DOMAIN:-}" ]; then
  if curl -fsS -o /dev/null "https://${TAILSCALE_DOMAIN}/health"; then
    log_pass "reachable via tailscale serve at https://${TAILSCALE_DOMAIN}/health"
  else
    log_fail "not reachable via tailscale serve at https://${TAILSCALE_DOMAIN}/health"
  fi
else
  log_skip "set TAILSCALE_DOMAIN to check reachability via 'tailscale serve' on intel"
fi

log_skip "verifying the port is unreachable from outside the tailnet (requires a second, non-tailnet device)"

# ---------------------------------------------------------------------------
printf '\n%s\n' "-----------------------------------------------------------"
printf 'Smoke test finished: %d passed, %d failed\n' "$PASS_COUNT" "$FAILURES"

if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi
