#!/bin/sh
# launchd (macOS) and systemd --user (Linux) start services with a minimal
# PATH and none of the interactive shell's environment — no ~/.zshrc,
# ~/.bash_profile, or the login-shell PATH that puts node/claude/codex/etc.
# on your terminal. Instead of duplicating that setup in two service-manager
# formats (plist XML vs. systemd unit syntax), the installer writes it once
# to a single env file and both the plist and the unit just exec this same
# wrapper, which loads that file before starting the server.
set -eu

set -a
. "__ENV_FILE__"
set +a

if [ -n "${RFC_CODE_PATH_PREPEND:-}" ]; then
	PATH="${RFC_CODE_PATH_PREPEND}:${PATH}"
	export PATH
fi

# Service managers start processes in `/`. The server spawns package managers
# whose target is resolved from the working directory, so an install triggered
# from the UI would try to build a dependency tree at the filesystem root.
# Anchor the process to the checkout, which is what those commands expect.
cd "__CHECKOUT__" || exit 1

exec "${RFC_CODE_NODE:-node}" "__CHECKOUT__/dist-server/server/index.js"
