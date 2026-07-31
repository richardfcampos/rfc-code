#!/usr/bin/env bash
#
# RFC Code — native installer (macOS LaunchAgent / Linux systemd user unit).
#
# Builds this checkout, writes ~/.rfc-code/{env,run/rfc-code-server}, clones the
# pinned caveman plugin, registers the OS service and waits for /health.
#
# Everything the service needs at boot lives in ~/.rfc-code/env, because service
# managers start processes without the interactive shell's environment. The
# wrapper reads that file; this script is the only thing that writes it.
#
# Usage: install/install.sh [--workspaces-root <path>] [--bind <addr>]
#                           [--port <n>] [--yes] [--dry-run]

set -euo pipefail

# --- Constants ---------------------------------------------------------------

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
TEMPLATE_DIR="$SCRIPT_DIR/templates"

PREFIX="$HOME/.rfc-code"
ENV_FILE="$PREFIX/env"
WRAPPER="$PREFIX/run/rfc-code-server"
LOG_DIR="$PREFIX/logs"
PLUGIN_DIR="$PREFIX/caveman-plugin"
BIN_DIR="$PREFIX/bin"

SERVICE_LABEL='ai.rfc-code.server'
PLIST_PATH="$HOME/Library/LaunchAgents/${SERVICE_LABEL}.plist"
UNIT_NAME='rfc-code.service'
UNIT_PATH="$HOME/.config/systemd/user/$UNIT_NAME"

# Same pin the container build used, so the plugin cannot change behaviour
# under an unrelated reinstall.
CAVEMAN_REPO='https://github.com/JuliusBrussee/caveman.git'
CAVEMAN_SHA='655b7d9c5431f822264b7732e9901c5578ac84cf'

# rtk release pin (checksums verified per asset; the `rtk` name on npm is an
# unrelated project, so the GitHub release is the only correct source).
RTK_VERSION='0.43.0'
RTK_ASSET_ARM64='rtk-aarch64-unknown-linux-gnu.tar.gz'
RTK_SHA_ARM64='5519f7ca12e5c143a609f0d28a0a77b97413a8dce31c2681f1a41c24519a8731'
RTK_ASSET_AMD64='rtk-x86_64-unknown-linux-musl.tar.gz'
RTK_SHA_AMD64='ff8a1e7766496e175291a85aeca1dc97c9ff6df33e51e5893d1fbc78fea2a609'

# CLIs the server shells out to. Their directories are recorded in the env file
# so the service resolves them the same way an interactive shell would.
AGENT_CLIS='node claude codex cursor-agent opencode rtk'

# --- Options -----------------------------------------------------------------

WORKSPACES_ROOT="$HOME"
BIND='127.0.0.1'
PORT='7789'
ASSUME_YES=0
DRY_RUN=0

# --- Output helpers ----------------------------------------------------------

step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
	cat <<'EOF'
RFC Code native installer

  --workspaces-root <path>  Parent directory of browsable projects (default: $HOME)
  --bind <addr>             Interface to listen on (default: 127.0.0.1)
  --port <n>                TCP port (default: 7789)
  --yes                     Do not ask for confirmation
  --dry-run                 Print every mutating action instead of doing it
  -h, --help                This help
EOF
}

# Runs a command, or prints it when --dry-run. Every mutation in this script
# goes through one of the run_* helpers or checks DRY_RUN explicitly.
run() {
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '    [dry-run] %s\n' "$*"
		return 0
	fi
	"$@"
}

# Same, but from the checkout directory (npm needs the manifest in cwd).
run_in_checkout() {
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '    [dry-run] (cd %s && %s)\n' "$REPO_ROOT" "$*"
		return 0
	fi
	( cd "$REPO_ROOT" && "$@" )
}

# Single-quotes a value for the env file. The checkout can live under a path
# with spaces, and the wrapper sources this file with `set -a` — an unquoted
# value would be parsed as a command, not as data.
shq() {
	printf "'%s'" "${1//\'/\'\\\'\'}"
}

# --- Argument parsing --------------------------------------------------------

while [ $# -gt 0 ]; do
	case "$1" in
		--workspaces-root) [ $# -ge 2 ] || die "--workspaces-root needs a value"; WORKSPACES_ROOT=$2; shift 2 ;;
		--bind)            [ $# -ge 2 ] || die "--bind needs a value";            BIND=$2;            shift 2 ;;
		--port)            [ $# -ge 2 ] || die "--port needs a value";            PORT=$2;            shift 2 ;;
		--yes|-y)          ASSUME_YES=1; shift ;;
		--dry-run)         DRY_RUN=1;    shift ;;
		-h|--help)         usage; exit 0 ;;
		*)                 usage >&2; die "unknown option: $1" ;;
	esac
done

case "$PORT" in
	''|*[!0-9]*) die "--port must be a number; got \"$PORT\"" ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port out of range: $PORT"

# The trusted-mode guard in server/middleware/auth.js refuses a wildcard bind
# under the native contract: a native install has no published-port boundary in
# front of it, so listening on every interface would expose every session to the
# whole LAN with no login at all. Reject it here rather than let the service
# fail to boot after everything is installed.
case "$BIND" in
	'0.0.0.0'|'::'|'')
		die "--bind must name one interface; \"$BIND\" is a wildcard.
       Trusted mode has no login, so a wildcard bind would publish every session
       to the whole LAN. Use 127.0.0.1, or a specific address such as a tailnet IP."
		;;
esac

IS_LOOPBACK=0
case "$BIND" in
	'127.0.0.1'|'::1'|'localhost') IS_LOOPBACK=1 ;;
esac

[ -d "$WORKSPACES_ROOT" ] || die "--workspaces-root does not exist: $WORKSPACES_ROOT"
WORKSPACES_ROOT=$(cd -- "$WORKSPACES_ROOT" && pwd)

# URL host for the health check: IPv6 literals need brackets.
HEALTH_HOST="$BIND"
case "$BIND" in
	*:*) HEALTH_HOST="[$BIND]" ;;
esac

# --- OS detection ------------------------------------------------------------

step "Detecting platform"
UNAME_S=$(uname -s)
case "$UNAME_S" in
	Darwin) OS='darwin'; SERVICE_DESC="LaunchAgent ($PLIST_PATH)" ;;
	Linux)  OS='linux';  SERVICE_DESC="systemd user unit ($UNIT_PATH)" ;;
	*)      die "unsupported OS: $UNAME_S (macOS and Linux only)" ;;
esac
info "$UNAME_S — $SERVICE_DESC"

# --- Preflight ---------------------------------------------------------------

step "Preflight"

[ -f "$REPO_ROOT/package.json" ] || die "no package.json in $REPO_ROOT — run this from the RFC Code checkout"
[ -d "$TEMPLATE_DIR" ] || die "missing templates directory: $TEMPLATE_DIR"
for tpl in env.example rfc-code-server.sh ai.rfc-code.server.plist rfc-code.service; do
	[ -f "$TEMPLATE_DIR/$tpl" ] || die "missing template: $TEMPLATE_DIR/$tpl"
done

NODE_BIN=$(command -v node 2>/dev/null || true)
[ -n "$NODE_BIN" ] || die "node not found on PATH. Install Node (see .nvmrc for the version) and re-run."

NODE_VERSION=$(node -v)            # e.g. v22.20.0
NODE_MAJOR=${NODE_VERSION#v}
NODE_MAJOR=${NODE_MAJOR%%.*}
REQUIRED_MAJOR='22'
if [ -f "$REPO_ROOT/.nvmrc" ]; then
	REQUIRED_MAJOR=$(tr -d ' \t\r' < "$REPO_ROOT/.nvmrc" | head -n 1)
	REQUIRED_MAJOR=${REQUIRED_MAJOR#v}
	REQUIRED_MAJOR=${REQUIRED_MAJOR%%.*}
fi
case "$NODE_MAJOR$REQUIRED_MAJOR" in
	*[!0-9]*) die "could not parse node versions (have \"$NODE_VERSION\", need \"$REQUIRED_MAJOR\")" ;;
esac
[ "$NODE_MAJOR" -ge "$REQUIRED_MAJOR" ] || \
	die "node $NODE_VERSION is too old; this checkout needs major $REQUIRED_MAJOR or newer (.nvmrc)"
info "node $NODE_VERSION at $NODE_BIN (requires >= $REQUIRED_MAJOR)"

command -v npm >/dev/null 2>&1 || die "npm not found on PATH"
command -v git >/dev/null 2>&1 || die "git not found on PATH (needed for the caveman plugin clone)"
command -v curl >/dev/null 2>&1 || die "curl not found on PATH (needed for the health check)"

# Who, if anyone, already listens on the chosen port. Never killed here: the old
# Docker container holds the app's data and stopping it is the operator's call.
port_listener() {
	local out=''
	if command -v lsof >/dev/null 2>&1; then
		out=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $1" (pid "$2")" }' | sort -u | tr '\n' ' ' || true)
	elif command -v ss >/dev/null 2>&1; then
		out=$(ss -Hltnp "sport = :$PORT" 2>/dev/null | tr -s ' ' | cut -d' ' -f5,6 | tr '\n' ' ' || true)
	fi
	printf '%s' "$out"
}

LISTENER=$(port_listener)
if [ -n "$LISTENER" ]; then
	PORT_MSG="port $PORT is already in use by: $LISTENER"
	case "$LISTENER" in
		*docker*|*Docker*|*com.docke*)
			PORT_HINT="That looks like the old RFC Code container. Stop it from the checkout
           you used to run it: cd <old checkout>/deploy && docker compose down"
			;;
		*)
			PORT_HINT="Stop that process yourself (or pass --port <n> to use a different port), then re-run."
			;;
	esac
	if [ "$DRY_RUN" -eq 1 ]; then
		warn "$PORT_MSG"
		info "$PORT_HINT"
		info "(a real run would abort here)"
	else
		die "$PORT_MSG
       $PORT_HINT
       Nothing was stopped automatically."
	fi
else
	info "port $PORT is free"
fi

# --- Plan / confirmation -----------------------------------------------------

step "Plan"
info "checkout:         $REPO_ROOT"
info "prefix:           $PREFIX"
info "listen:           http://$HEALTH_HOST:$PORT"
info "workspaces root:  $WORKSPACES_ROOT"
info "service:          $SERVICE_DESC"
if [ "$IS_LOOPBACK" -eq 0 ]; then
	info "auth:             trusted + AUTH_TRUSTED_NATIVE_BIND=1 (non-loopback bind, no login)"
else
	info "auth:             trusted (loopback only)"
fi

if [ "$DRY_RUN" -eq 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
	printf '\nProceed? [y/N] '
	read -r reply
	case "$reply" in
		y|Y|yes|YES) ;;
		*) die "aborted by user" ;;
	esac
fi

# --- Build -------------------------------------------------------------------

step "Building the checkout"
run_in_checkout npm ci --no-audit --no-fund
run_in_checkout npm run build

# --- Layout ------------------------------------------------------------------

step "Creating $PREFIX"
run mkdir -p "$PREFIX/data/db" "$PREFIX/data/profiles" "$LOG_DIR" "$PREFIX/run" "$BIN_DIR"

# --- Caveman plugin ----------------------------------------------------------

step "Caveman plugin"
if [ -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ]; then
	info "already present at $PLUGIN_DIR — left untouched"
else
	info "cloning $CAVEMAN_REPO at $CAVEMAN_SHA"
	# A half-finished clone from an interrupted run would make the checkout
	# below fail, so start from a clean directory.
	run rm -rf "$PLUGIN_DIR"
	run git clone --quiet "$CAVEMAN_REPO" "$PLUGIN_DIR"
	run git -C "$PLUGIN_DIR" checkout --quiet "$CAVEMAN_SHA"
	# The plugin is pinned content, not a tracked dependency; dropping .git
	# keeps a stray remote out of the runtime tree.
	run rm -rf "$PLUGIN_DIR/.git"
	if [ "$DRY_RUN" -eq 0 ]; then
		[ -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ] || die "caveman clone did not produce .claude-plugin/plugin.json"
	fi
fi

# --- rtk ---------------------------------------------------------------------

step "rtk"
RTK_EXTRA_DIR=''
if command -v rtk >/dev/null 2>&1; then
	info "using the host's rtk at $(command -v rtk)"
elif [ "$OS" = 'darwin' ]; then
	# No pinned macOS asset is verified here, and installing an unverified
	# binary is worse than not having the hook: warn and continue.
	warn "rtk not found. The per-profile command-rewriting hook will be inert until it is installed."
	info "Install it from https://github.com/rtk-ai/rtk/releases (v$RTK_VERSION) and re-run this installer to pick it up."
else
	RTK_ARCH=$(uname -m)
	RTK_ASSET=''
	RTK_SHA=''
	case "$RTK_ARCH" in
		aarch64|arm64)  RTK_ASSET=$RTK_ASSET_ARM64; RTK_SHA=$RTK_SHA_ARM64 ;;
		x86_64|amd64)   RTK_ASSET=$RTK_ASSET_AMD64; RTK_SHA=$RTK_SHA_AMD64 ;;
	esac
	if [ -z "$RTK_ASSET" ]; then
		warn "no pinned rtk build for $RTK_ARCH — skipping (the compression hook will be inert)."
	else
		info "downloading $RTK_ASSET (v$RTK_VERSION) with pinned sha256"
		if [ "$DRY_RUN" -eq 1 ]; then
			printf '    [dry-run] curl -fsSL https://github.com/rtk-ai/rtk/releases/download/v%s/%s -> %s/rtk\n' \
				"$RTK_VERSION" "$RTK_ASSET" "$BIN_DIR"
			printf '    [dry-run] verify sha256 %s, then install -m 0755 into %s\n' "$RTK_SHA" "$BIN_DIR"
		else
			rtk_tmp=$(mktemp -d)
			# A re-tagged or tampered release must fail loudly instead of
			# silently installing a different binary.
			curl -fsSL -o "$rtk_tmp/rtk.tar.gz" \
				"https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/${RTK_ASSET}"
			printf '%s  %s\n' "$RTK_SHA" "$rtk_tmp/rtk.tar.gz" | sha256sum -c -
			tar -xzf "$rtk_tmp/rtk.tar.gz" -C "$rtk_tmp"
			rtk_bin=$(find "$rtk_tmp" -maxdepth 2 -type f -name rtk | head -n 1)
			[ -n "$rtk_bin" ] || die "rtk archive did not contain an rtk binary"
			install -m 0755 "$rtk_bin" "$BIN_DIR/rtk"
			rm -rf "$rtk_tmp"
			"$BIN_DIR/rtk" --version
		fi
		RTK_EXTRA_DIR="$BIN_DIR"
	fi
fi

# --- CLI probe / PATH --------------------------------------------------------

step "Probing agent CLIs"

PATH_PREPEND=''
add_path_dir() {
	case ":$PATH_PREPEND:" in
		*":$1:"*) return 0 ;;
	esac
	if [ -z "$PATH_PREPEND" ]; then PATH_PREPEND=$1; else PATH_PREPEND="$PATH_PREPEND:$1"; fi
}

MISSING_CLIS=''
for cli in $AGENT_CLIS; do
	cli_path=$(command -v "$cli" 2>/dev/null || true)
	if [ -n "$cli_path" ]; then
		cli_dir=$(cd -- "$(dirname -- "$cli_path")" && pwd)
		add_path_dir "$cli_dir"
		info "$cli -> $cli_path"
	else
		MISSING_CLIS="$MISSING_CLIS $cli"
	fi
done
# rtk installed by this run is not on the current PATH yet.
if [ -n "$RTK_EXTRA_DIR" ]; then
	add_path_dir "$RTK_EXTRA_DIR"
fi

if [ -n "$MISSING_CLIS" ]; then
	# Not fatal: a missing CLI only breaks the sessions that dispatch to it, and
	# installing one later just needs its directory added to RFC_CODE_PATH_PREPEND
	# (or a re-run of this installer).
	warn "not found on PATH:${MISSING_CLIS}. Sessions using those agents will fail until they are installed."
fi

# --- Env file ----------------------------------------------------------------

ENV_KEYS=()
ENV_VALS=()
add_env() {
	ENV_KEYS[${#ENV_KEYS[@]}]=$1
	ENV_VALS[${#ENV_VALS[@]}]=$2
}
env_lookup() {
	local i=0
	while [ "$i" -lt "${#ENV_KEYS[@]}" ]; do
		if [ "${ENV_KEYS[$i]}" = "$1" ]; then
			printf '%s' "${ENV_VALS[$i]}"
			return 0
		fi
		i=$((i + 1))
	done
	return 1
}

add_env SERVER_PORT "$PORT"
add_env HOST "$BIND"
add_env AUTH_MODE 'trusted'
if [ "$IS_LOOPBACK" -eq 0 ]; then
	# The guard refuses a non-loopback bind in trusted mode unless this contract
	# is declared; declaring it for a loopback bind would only widen what the
	# guard accepts for no reason.
	add_env AUTH_TRUSTED_NATIVE_BIND '1'
fi
add_env DATABASE_PATH "$PREFIX/data/db/auth.db"
add_env PROFILES_ROOT "$PREFIX/data/profiles"
add_env WORKSPACES_ROOT "$WORKSPACES_ROOT"
add_env BUNDLED_SKILLS_ROOT "$REPO_ROOT/skills"
# Written explicitly on every install: the code default points at the path the
# Docker image used, which does not exist natively — relying on it would leave
# the compression switch enabled in the UI and inert in practice.
add_env CAVEMAN_PLUGIN_PATH "$PLUGIN_DIR"
add_env RFC_CODE_NODE "$NODE_BIN"
add_env RFC_CODE_PATH_PREPEND "$PATH_PREPEND"

# Renders templates/env.example with real values: every documented key keeps its
# comments (and its place), only the value is replaced; commented-out keys we
# need are uncommented. Keys the template does not mention are appended.
render_env() {
	local emitted=':' line key val
	while IFS= read -r line || [ -n "$line" ]; do
		line=${line//__CHECKOUT__/$REPO_ROOT}
		case "$line" in
			[A-Za-z_]*=*|'#'[A-Za-z_]*=*)
				key=${line#\#}
				key=${key%%=*}
				if val=$(env_lookup "$key"); then
					case "$emitted" in *":$key:"*) continue ;; esac
					emitted="$emitted$key:"
					printf '%s=%s\n' "$key" "$(shq "$val")"
					continue
				fi
				;;
		esac
		printf '%s\n' "$line"
	done < "$TEMPLATE_DIR/env.example"

	local i=0 extra=0
	while [ "$i" -lt "${#ENV_KEYS[@]}" ]; do
		key=${ENV_KEYS[$i]}
		case "$emitted" in
			*":$key:"*) ;;
			*)
				if [ "$extra" -eq 0 ]; then
					printf '\n# --- Added by install.sh --------------------------------------------------\n'
					extra=1
				fi
				printf '%s=%s\n' "$key" "$(shq "${ENV_VALS[$i]}")"
				;;
		esac
		i=$((i + 1))
	done
}

step "Env file ($ENV_FILE)"
if [ -f "$ENV_FILE" ]; then
	info "already exists, left untouched — the service will keep using it"
	warn "the values probed by this run were NOT applied. Delete $ENV_FILE and re-run to regenerate it."
elif [ "$DRY_RUN" -eq 1 ]; then
	printf '    [dry-run] write %s from %s with:\n' "$ENV_FILE" "$TEMPLATE_DIR/env.example"
	render_env | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' | sed 's/^/      /' || true
else
	render_env > "$ENV_FILE"
	chmod 600 "$ENV_FILE"
	info "written"
fi

# --- Wrapper -----------------------------------------------------------------

# Fills the __TOKEN__ placeholders of a template and writes the result.
# Substitution is done in the shell rather than with sed so paths containing
# slashes, spaces or `&` need no escaping.
install_template() {
	local src=$1 dest=$2 mode=$3 content
	content=$(cat "$src")
	content=${content//__WRAPPER__/$WRAPPER}
	content=${content//__LOG_DIR__/$LOG_DIR}
	content=${content//__ENV_FILE__/$ENV_FILE}
	content=${content//__CHECKOUT__/$REPO_ROOT}
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '    [dry-run] write %s (mode %s) from %s\n' "$dest" "$mode" "$src"
		return 0
	fi
	mkdir -p "$(dirname -- "$dest")"
	printf '%s\n' "$content" > "$dest"
	chmod "$mode" "$dest"
}

step "Wrapper ($WRAPPER)"
install_template "$TEMPLATE_DIR/rfc-code-server.sh" "$WRAPPER" 755

# --- Service registration ----------------------------------------------------

step "Registering the service"
if [ "$OS" = 'darwin' ]; then
	install_template "$TEMPLATE_DIR/ai.rfc-code.server.plist" "$PLIST_PATH" 644
	uid=$(id -u)
	# bootout first so a re-run replaces the running definition instead of
	# failing with "service already loaded"; it fails harmlessly when nothing
	# is registered yet.
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '    [dry-run] launchctl bootout gui/%s/%s (failure ignored)\n' "$uid" "$SERVICE_LABEL"
	else
		launchctl bootout "gui/$uid/$SERVICE_LABEL" 2>/dev/null || true
	fi
	run launchctl bootstrap "gui/$uid" "$PLIST_PATH"
	run launchctl kickstart -k "gui/$uid/$SERVICE_LABEL"
else
	install_template "$TEMPLATE_DIR/rfc-code.service" "$UNIT_PATH" 644
	run systemctl --user daemon-reload
	run systemctl --user enable --now "$UNIT_NAME"
	# Linger lets the user unit start at boot without an open session.
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '    [dry-run] loginctl enable-linger %s\n' "$USER"
	else
		loginctl enable-linger "$USER" || warn "loginctl enable-linger failed — the service will only start once you log in."
	fi
fi

# --- Health check ------------------------------------------------------------

step "Health check"
HEALTH_URL="http://$HEALTH_HOST:$PORT/health"
if [ "$DRY_RUN" -eq 1 ]; then
	printf '    [dry-run] poll %s for up to 60s\n' "$HEALTH_URL"
else
	healthy=0
	deadline=$((SECONDS + 60))
	while [ "$SECONDS" -lt "$deadline" ]; do
		if curl -fsS -m 3 -o /dev/null "$HEALTH_URL"; then
			healthy=1
			break
		fi
		sleep 1
	done
	if [ "$healthy" -eq 1 ]; then
		info "up: $HEALTH_URL"
	else
		printf 'ERROR: the service did not answer %s within 60s.\n' "$HEALTH_URL" >&2
		printf '       Check the log:\n           tail -n 100 %s/stderr.log\n' "$LOG_DIR" >&2
		exit 1
	fi
fi

# --- Summary -----------------------------------------------------------------

cat <<EOF

Done.

  App          http://$HEALTH_HOST:$PORT
  Checkout     $REPO_ROOT        (update = git pull + re-run this script)
  Config       $ENV_FILE
  Data         $PREFIX/data      (db/auth.db, profiles/)
  Plugin       $PLUGIN_DIR
  Wrapper      $WRAPPER
  Service      $SERVICE_DESC

  Logs         tail -f $LOG_DIR/stderr.log
EOF

if [ "$OS" = 'darwin' ]; then
	cat <<EOF
  Restart      launchctl kickstart -k gui/\$(id -u)/$SERVICE_LABEL
  Uninstall    $SCRIPT_DIR/uninstall.sh   (data in $PREFIX/data is kept)

  A LaunchAgent starts at *login*, not at boot. For "starts when the Mac is
  powered on", enable automatic login in Ajustes > Usuários e Grupos > Opções.
EOF
else
	cat <<EOF
  Restart      systemctl --user restart $UNIT_NAME
  Uninstall    $SCRIPT_DIR/uninstall.sh   (data in $PREFIX/data is kept)
EOF
fi

if [ "$DRY_RUN" -eq 1 ]; then
	printf '\n(dry run — nothing above was actually changed)\n'
fi
