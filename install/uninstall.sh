#!/usr/bin/env bash
# RFC Code — native service uninstaller.
#
# Stops and removes the OS service registration (launchd on macOS, systemd
# --user on Linux) plus the generated wrapper script. Everything else under
# ~/.rfc-code is left in place on purpose:
#
#   - env/            the only config; re-running install/install.sh reuses it
#   - data/            db/auth.db + profiles/ — the only stateful thing RFC
#                      Code owns. Losing it means losing every session and
#                      every stored credential, so uninstall never touches it.
#   - logs/            stdout/stderr history, harmless to keep around
#   - caveman-plugin/  pinned clone, cheap to keep, expensive to re-clone
#
# Uninstall is "stop running this service" — not "delete my data". A purge
# is a separate, explicit decision the user has to make themselves (rm -rf
# ~/.rfc-code), never something this script does on their behalf.
#
# Safe to run more than once: every step first checks whether there's
# anything to do and says so instead of failing when the service was never
# installed, already removed, or only half-installed.

set -euo pipefail

RFC_HOME="$HOME/.rfc-code"
WRAPPER="$RFC_HOME/run/rfc-code-server"

DARWIN_LABEL="ai.rfc-code.server"
DARWIN_PLIST="$HOME/Library/LaunchAgents/${DARWIN_LABEL}.plist"

LINUX_UNIT_NAME="rfc-code"
LINUX_UNIT_PATH="$HOME/.config/systemd/user/${LINUX_UNIT_NAME}.service"

DRY_RUN=0

usage() {
	cat <<EOF
Usage: uninstall.sh [--dry-run] [-h|--help]

Stops the RFC Code service, removes its launchd/systemd registration and
the generated wrapper. Data in $RFC_HOME/{env,data,logs,caveman-plugin}
is preserved.

  --dry-run   Print what would be done without changing anything.
  -h, --help  Show this help.
EOF
}

parse_args() {
	while [ "$#" -gt 0 ]; do
		case "$1" in
		--dry-run)
			DRY_RUN=1
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "uninstall.sh: unknown option '$1'" >&2
			usage >&2
			exit 1
			;;
		esac
		shift
	done
}

log() {
	printf '%s\n' "$*"
}

uninstall_darwin() {
	local target="gui/${UID}/${DARWIN_LABEL}"

	if [ "$DRY_RUN" -eq 1 ]; then
		if launchctl print "$target" >/dev/null 2>&1; then
			log "[dry-run] would run: launchctl bootout $target"
		else
			log "[dry-run] $DARWIN_LABEL is not loaded — bootout would be a no-op"
		fi
	else
		if launchctl bootout "$target" >/dev/null 2>&1; then
			log "stopped and unloaded $DARWIN_LABEL"
		else
			log "$DARWIN_LABEL was not loaded (nothing to stop)"
		fi
	fi

	if [ -f "$DARWIN_PLIST" ]; then
		if [ "$DRY_RUN" -eq 1 ]; then
			log "[dry-run] would remove $DARWIN_PLIST"
		else
			rm -f "$DARWIN_PLIST"
			log "removed $DARWIN_PLIST"
		fi
	else
		log "$DARWIN_PLIST already absent (nothing to do)"
	fi
}

uninstall_linux() {
	local unit="${LINUX_UNIT_NAME}.service"

	if [ "$DRY_RUN" -eq 1 ]; then
		if systemctl --user is-enabled "$unit" >/dev/null 2>&1 || systemctl --user is-active "$unit" >/dev/null 2>&1; then
			log "[dry-run] would run: systemctl --user disable --now $LINUX_UNIT_NAME"
		else
			log "[dry-run] $LINUX_UNIT_NAME is not enabled or running — disable --now would be a no-op"
		fi
	else
		if systemctl --user disable --now "$LINUX_UNIT_NAME" >/dev/null 2>&1; then
			log "stopped and disabled $LINUX_UNIT_NAME"
		else
			log "$LINUX_UNIT_NAME was not enabled or running (nothing to stop)"
		fi
	fi

	if [ -f "$LINUX_UNIT_PATH" ]; then
		if [ "$DRY_RUN" -eq 1 ]; then
			log "[dry-run] would remove $LINUX_UNIT_PATH"
		else
			rm -f "$LINUX_UNIT_PATH"
			log "removed $LINUX_UNIT_PATH"
		fi
	else
		log "$LINUX_UNIT_PATH already absent (nothing to do)"
	fi

	if [ "$DRY_RUN" -eq 1 ]; then
		log "[dry-run] would run: systemctl --user daemon-reload"
	else
		systemctl --user daemon-reload
		log "reloaded systemd --user daemon"
	fi
}

remove_wrapper() {
	if [ -f "$WRAPPER" ]; then
		if [ "$DRY_RUN" -eq 1 ]; then
			log "[dry-run] would remove $WRAPPER"
		else
			rm -f "$WRAPPER"
			log "removed $WRAPPER"
		fi
	else
		log "$WRAPPER already absent (nothing to do)"
	fi
}

print_preserved() {
	log ""
	log "Preserved (uninstall stops the service, it does not purge state):"
	log "  $RFC_HOME/env             service config"
	log "  $RFC_HOME/data            db/auth.db + profiles/ — the only stateful data"
	log "  $RFC_HOME/logs            stdout/stderr history"
	log "  $RFC_HOME/caveman-plugin  pinned plugin clone"
	log ""
	log "Re-running install/install.sh reinstalls the service in place and reuses all of the above."
}

main() {
	parse_args "$@"

	case "$(uname -s)" in
	Darwin)
		uninstall_darwin
		;;
	Linux)
		uninstall_linux
		;;
	*)
		echo "uninstall.sh: unsupported OS '$(uname -s)' (only Darwin and Linux are supported)" >&2
		exit 1
		;;
	esac

	remove_wrapper
	print_preserved
}

main "$@"
