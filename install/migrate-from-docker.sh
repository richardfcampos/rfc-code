#!/usr/bin/env bash
#
# One-shot migration of RFC Code data from the retired Docker deploy to the
# native layout (see install/install.sh, install/templates/env.example).
#
#   docker data root                      native layout
#   <data-root>/db/auth.db          ->    ~/.rfc-code/data/db/auth.db
#   <data-root>/profiles/           ->    ~/.rfc-code/data/profiles/
#   <data-root>/default/*                 NOT migrated (see "skipped" below)
#
# Two things inside that data are container-shaped and stop working the moment
# the app runs natively:
#
#  1. Absolute project paths. The container saw the projects mount as
#     /projects/<name>; natively the same tree lives at its real host path, so
#     every sessions/projects row that stored a /projects path points nowhere.
#     --projects-map rewrites that prefix inside the migrated copy of the DB.
#
#  2. Absolute paths baked into profile state. Per-profile skill links pointed
#     at /opt/rfc-code/skills (the image's bundle) and installed_plugins.json
#     recorded /opt/claude-plugins/caveman as the plugin installPath. Natively
#     those live in the checkout and under ~/.rfc-code respectively.
#
# The source data root is only ever read: the DB is copied (a .pre-migrate copy
# is also left beside the original) and profiles are copied before anything is
# rewritten. Every mutation happens in the target copy.
#
# Usage:
#   install/migrate-from-docker.sh \
#     --data-root "/Volumes/External Code/Docker/rfc-code-data" \
#     --projects-map "/projects=/Volumes/External Code/M1/Code" \
#     --checkout "$HOME/Code/rfc-code" \
#     [--dry-run] [--force] [--target-root <dir>]

set -euo pipefail

# Paths the image used. These are the compiled-in defaults of
# server/modules/bundled-skills/bundled-skills.ts (getBundledSkillsRoot) and
# server/modules/agent-tooling/caveman-plugin.ts (resolveCavemanPluginPath):
# anything still pointing here was written by the container.
readonly DOCKER_SKILLS_ROOT='/opt/rfc-code/skills'
readonly DOCKER_CAVEMAN_PATH='/opt/claude-plugins/caveman'
readonly DEFAULT_PORT=7789

DATA_ROOT=''
PROJECTS_MAP=''
CHECKOUT=''
TARGET_ROOT=''
DRY_RUN=0
FORCE=0

# Profile tree the repair pass walks: the migrated copy, or — in a dry run,
# where no copy exists — the source, read but never written.
SCAN_ROOT=''

# Counters reported in the closing summary.
LINKS_REPAIRED=0
LINKS_REMOVED=0
LINKS_LEFT_ALONE=0
JSON_REWRITTEN=0

usage() {
	cat <<'EOF'
Migrate RFC Code data from the Docker deploy to the native layout.

Required:
  --data-root <path>       Docker data root (the host dir mounted at /data).
  --projects-map <from=to> Path prefix rewrite for project paths, e.g.
                           "/projects=/Volumes/External Code/M1/Code".
  --checkout <path>        Git checkout the native service runs from; bundled
                           skills resolve to <checkout>/skills.

Optional:
  --dry-run                Report what would happen. Mutates nothing.
  --force                  Overwrite an existing target DB / profiles dir. The
                           existing target DB is moved aside first, never
                           deleted.
  --target-root <dir>      Native data dir. Defaults to ~/.rfc-code/data.
                           Mainly a test hook: the caveman plugin path written
                           into migrated profiles is derived from its parent
                           (<target-root>/../caveman-plugin), so pointing this
                           at a scratch dir keeps the whole migration inside it.
  -h, --help               This message.
EOF
}

log() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

# Prefix for lines describing an action that --dry-run suppresses.
act() {
	if ((DRY_RUN)); then
		printf '  [dry-run] would %s\n' "$*"
	else
		printf '  %s\n' "$*"
	fi
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

parse_args() {
	while (($# > 0)); do
		case "$1" in
		--data-root)
			[[ $# -ge 2 ]] || die "--data-root needs a value"
			DATA_ROOT="$2"
			shift 2
			;;
		--projects-map)
			[[ $# -ge 2 ]] || die "--projects-map needs a value"
			PROJECTS_MAP="$2"
			shift 2
			;;
		--checkout)
			[[ $# -ge 2 ]] || die "--checkout needs a value"
			CHECKOUT="$2"
			shift 2
			;;
		--target-root)
			[[ $# -ge 2 ]] || die "--target-root needs a value"
			TARGET_ROOT="$2"
			shift 2
			;;
		--dry-run)
			DRY_RUN=1
			shift
			;;
		--force)
			FORCE=1
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		*) die "unknown argument: $1 (try --help)" ;;
		esac
	done

	[[ -n $DATA_ROOT ]] || die "--data-root is required (try --help)"
	[[ -n $PROJECTS_MAP ]] || die "--projects-map is required (try --help)"
	[[ -n $CHECKOUT ]] || die "--checkout is required (try --help)"
}

# Splits "<from>=<to>" on the FIRST '=' so the destination may contain one.
parse_projects_map() {
	[[ $PROJECTS_MAP == *=* ]] || die "--projects-map must look like \"<from>=<to>\""
	MAP_FROM="${PROJECTS_MAP%%=*}"
	MAP_TO="${PROJECTS_MAP#*=}"

	# Trailing slashes would make the rewritten paths grow a double slash.
	while [[ $MAP_FROM == */ && ${#MAP_FROM} -gt 1 ]]; do MAP_FROM="${MAP_FROM%/}"; done
	while [[ $MAP_TO == */ && ${#MAP_TO} -gt 1 ]]; do MAP_TO="${MAP_TO%/}"; done

	[[ $MAP_FROM == /* ]] || die "--projects-map source must be an absolute path, got: $MAP_FROM"
	[[ $MAP_TO == /* ]] || die "--projects-map destination must be an absolute path, got: $MAP_TO"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

# Reads SERVER_PORT out of the native env file so the listener check targets
# the port this install actually uses. Falls back to the documented default.
resolve_port() {
	local env_file="$RFC_HOME/env" value=''
	if [[ -r $env_file ]]; then
		value="$(sed -n 's/^[[:space:]]*SERVER_PORT=\([0-9][0-9]*\).*$/\1/p' "$env_file" | tail -n 1)"
	fi
	printf '%s' "${value:-$DEFAULT_PORT}"
}

# 0 = something is listening, 1 = nothing, 2 = could not tell.
port_listening() {
	local port="$1"
	if command -v lsof >/dev/null 2>&1; then
		lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
		return 1
	fi
	if command -v nc >/dev/null 2>&1; then
		nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && return 0
		return 1
	fi
	return 2
}

preflight() {
	step "Preflight"

	command -v sqlite3 >/dev/null 2>&1 ||
		die "the sqlite3 CLI is required (macOS ships it at /usr/bin/sqlite3; Debian/Ubuntu: apt install sqlite3)"
	log "  sqlite3: $(command -v sqlite3) ($(sqlite3 --version | cut -d' ' -f1))"

	[[ -d $DATA_ROOT ]] || die "--data-root is not a directory: $DATA_ROOT"
	[[ -f $SRC_DB ]] || die "source database not found: $SRC_DB"
	log "  source DB: $SRC_DB"

	if [[ -d $SRC_PROFILES ]]; then
		log "  source profiles: $SRC_PROFILES"
	else
		warn "no profiles directory at $SRC_PROFILES — only the database will be migrated"
	fi

	[[ -d $CHECKOUT ]] || die "--checkout is not a directory: $CHECKOUT"
	if [[ ! -d $CHECKOUT/skills ]]; then
		warn "$CHECKOUT/skills does not exist — every bundled-skill link will be dropped as dangling"
	fi

	if [[ -e $DST_DB ]]; then
		((FORCE)) || die "target database already exists: $DST_DB
Re-run with --force to replace it (the existing file is moved aside, not deleted)."
		log "  target DB exists; --force given, it will be moved aside"
	fi
	if [[ -e $DST_PROFILES ]]; then
		((FORCE)) || die "target profiles directory already exists: $DST_PROFILES
Re-run with --force to merge the migrated profiles into it."
		log "  target profiles exist; --force given, migrated profiles merge on top"
	fi

	# A live server on either side is the real hazard: the native one would be
	# reading the DB we are about to replace, and the container would still be
	# writing the DB we are about to copy.
	local status=0
	port_listening "$PORT" || status=$?
	case $status in
	0) die "something is listening on port $PORT.
Stop it before migrating — the native service must not be reading the database
while it is replaced, and the old container must not be writing the source one:
  macOS:  launchctl bootout gui/\$UID/ai.rfc-code.server
  Linux:  systemctl --user stop rfc-code
  Docker: in the checkout you used to run the container from, docker compose -f deploy/docker-compose.yml down" ;;
	1) log "  port $PORT: free" ;;
	*) warn "neither lsof nor nc is available — could not verify that port $PORT is free" ;;
	esac
}

# ---------------------------------------------------------------------------
# Copy
# ---------------------------------------------------------------------------

copy_data() {
	step "Copy"

	# Backup first, with a plain file copy, so it is a byte-for-byte snapshot
	# taken before anything else touches the source directory.
	local backup="$SRC_DB.pre-migrate"
	if [[ -e $backup ]]; then
		log "  backup already present, left untouched: $backup"
	else
		act "copy $SRC_DB -> $backup"
		((DRY_RUN)) || cp -p "$SRC_DB" "$backup"
		local sidecar
		for sidecar in "$SRC_DB-wal" "$SRC_DB-shm"; do
			[[ -f $sidecar ]] || continue
			act "copy $sidecar -> $sidecar.pre-migrate"
			((DRY_RUN)) || cp -p "$sidecar" "$sidecar.pre-migrate"
		done
	fi

	act "create $DST_DB_DIR"
	((DRY_RUN)) || mkdir -p "$DST_DB_DIR"

	if [[ -e $DST_DB ]]; then
		local stamp
		stamp="$(date +%Y%m%d-%H%M%S)"
		act "move existing $DST_DB aside to $DST_DB.replaced-$stamp"
		((DRY_RUN)) || mv "$DST_DB" "$DST_DB.replaced-$stamp"
	fi

	# `VACUUM INTO` rather than `cp`: it takes a read transaction on the source
	# and folds any -wal content into the copy, so the target cannot lose
	# transactions that were committed but not yet checkpointed, and it lands
	# as one self-contained file with no sidecars. It reads the source, it does
	# not modify it. (SQLite >= 3.27; both macOS and any current distro ship
	# well past that.)
	act "copy database -> $DST_DB (sqlite3 VACUUM INTO, WAL-safe)"
	if ((DRY_RUN == 0)); then
		sqlite3 "$SRC_DB" "VACUUM INTO '$(sql_escape "$DST_DB")';" ||
			die "copying the database failed — is it locked by a running server?"
	fi

	if [[ -d $SRC_PROFILES ]]; then
		# -a keeps symlinks as symlinks (they are repaired in place further
		# down) and preserves modes — profile credential files are 0600.
		act "copy profiles -> $DST_PROFILES (symlinks preserved as symlinks)"
		if ((DRY_RUN == 0)); then
			mkdir -p "$DST_PROFILES"
			cp -a "$SRC_PROFILES/." "$DST_PROFILES/"
		fi
	fi
}

# ---------------------------------------------------------------------------
# SQLite path rewrite
# ---------------------------------------------------------------------------

sql_escape() { printf '%s' "${1//\'/\'\'}"; }

# The WHERE clause is written with substr() instead of the more obvious
# `LIKE prefix || '/%'` because LIKE would treat '%' and '_' in the prefix as
# wildcards — '_' is perfectly ordinary in a directory name.
where_prefix() {
	local column="$1" from="$2"
	printf "%s = '%s' OR substr(%s, 1, length('%s') + 1) = '%s/'" \
		"$column" "$from" "$column" "$from" "$from"
}

count_rows() {
	local db="$1" table="$2" column="$3" from="$4"
	sqlite3 -readonly "$db" \
		"SELECT count(*) FROM $table WHERE $(where_prefix "$column" "$from");" 2>/dev/null || printf '0'
}

rewrite_paths() {
	step "Rewrite project paths in the migrated database"
	log "  $MAP_FROM  ->  $MAP_TO"

	local from to
	from="$(sql_escape "$MAP_FROM")"
	to="$(sql_escape "$MAP_TO")"

	if ((DRY_RUN)); then
		# Counted against the source, read-only: in a dry run no copy exists.
		log "  [dry-run] rows that would change:"
		log "    projects.project_path: $(count_rows "$SRC_DB" projects project_path "$from")"
		log "    sessions.project_path: $(count_rows "$SRC_DB" sessions project_path "$from")"
		log "    sessions.jsonl_path:   $(count_rows "$SRC_DB" sessions jsonl_path "$from")"
		return
	fi

	# sessions.project_path carries a foreign key onto projects.project_path
	# (ON UPDATE CASCADE). With enforcement on, updating the parent would
	# cascade into sessions mid-transaction and the explicit sessions UPDATE
	# below would then find nothing — worse, any row whose parent is missing
	# would abort the whole rewrite. Enforcement is therefore off for the
	# duration and the result is checked against a baseline afterwards.
	# `PRAGMA foreign_keys` is a no-op inside a transaction, hence the ordering.
	local baseline after
	baseline="$(sqlite3 "$DST_DB" 'PRAGMA foreign_keys=ON; PRAGMA foreign_key_check;' | wc -l | tr -d ' ')"

	local output
	output="$(sqlite3 "$DST_DB" <<SQL
.bail on
PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
UPDATE projects
   SET project_path = '$to' || substr(project_path, length('$from') + 1)
 WHERE $(where_prefix project_path "$from");
SELECT 'projects.project_path|' || changes();
UPDATE sessions
   SET project_path = '$to' || substr(project_path, length('$from') + 1)
 WHERE $(where_prefix project_path "$from");
SELECT 'sessions.project_path|' || changes();
UPDATE sessions
   SET jsonl_path = '$to' || substr(jsonl_path, length('$from') + 1)
 WHERE $(where_prefix jsonl_path "$from");
SELECT 'sessions.jsonl_path|' || changes();
COMMIT;
SQL
	)" || die "the path rewrite failed; $DST_DB is unchanged (the transaction rolled back)"

	while IFS='|' read -r label count; do
		[[ -n $label ]] || continue
		printf '  %-24s %s row(s) rewritten\n' "$label" "$count"
	done <<<"$output"

	after="$(sqlite3 "$DST_DB" 'PRAGMA foreign_keys=ON; PRAGMA foreign_key_check;' | wc -l | tr -d ' ')"
	if ((after > baseline)); then
		die "the rewrite introduced $((after - baseline)) foreign-key violation(s) in $DST_DB.
The pre-migration copy is intact at $SRC_DB.pre-migrate; delete the target and re-run."
	fi
	if ((baseline > 0)); then
		warn "$baseline pre-existing foreign-key violation(s) carried over from the source DB (not caused by this migration)"
	fi
	log "  foreign key check: no new violations"
}

# ---------------------------------------------------------------------------
# Container-path repair inside the migrated profiles
# ---------------------------------------------------------------------------

repair_profiles() {
	step "Repair container paths in profiles"

	# In a dry run nothing was copied, so the source tree is what gets scanned.
	# It is never written to; paths are reported under the target so the plan
	# describes what a real run would do — to the copy, not to the original.
	SCAN_ROOT="$DST_PROFILES"
	((DRY_RUN)) && SCAN_ROOT="$SRC_PROFILES"
	if [[ ! -d $SCAN_ROOT ]]; then
		log "  no profiles to repair"
		return
	fi

	repair_skill_links
	repair_plugin_registries
}

# Reports a scanned path at the location a real run would act on.
as_target_path() { printf '%s' "$DST_PROFILES${1#"$SCAN_ROOT"}"; }

repair_skill_links() {
	local link target suffix candidate
	while IFS= read -r -d '' link; do
		target="$(readlink "$link")"
		# Only links into the image's bundle are ours to touch. A profile may
		# hold skills of its own, and those point somewhere else entirely.
		case "$target" in
		"$DOCKER_SKILLS_ROOT")
			# A link at the bundle root rather than at one skill: the whole
			# directory moves to the checkout, so the target is just as direct.
			candidate="$CHECKOUT/skills"
			;;
		"$DOCKER_SKILLS_ROOT"/*)
			suffix="${target#"$DOCKER_SKILLS_ROOT"/}"
			candidate="$CHECKOUT/skills/$suffix"
			;;
		*)
			LINKS_LEFT_ALONE=$((LINKS_LEFT_ALONE + 1))
			continue
			;;
		esac

		if [[ -e $candidate ]]; then
			act "re-point $(as_target_path "$link") -> $candidate"
			if ((DRY_RUN == 0)); then
				rm -f "$link"
				ln -s "$candidate" "$link"
			fi
			LINKS_REPAIRED=$((LINKS_REPAIRED + 1))
		else
			# The bundle no longer ships this skill; the link can only dangle.
			act "remove dangling link $(as_target_path "$link") (no $candidate)"
			((DRY_RUN)) || rm -f "$link"
			LINKS_REMOVED=$((LINKS_REMOVED + 1))
		fi
	done < <(find "$SCAN_ROOT" -type l -print0 2>/dev/null)

	log "  skill links: $LINKS_REPAIRED re-pointed, $LINKS_REMOVED removed as dangling, $LINKS_LEFT_ALONE left alone (not ours)"
}

repair_plugin_registries() {
	local file tmp
	# The replacement lands inside JSON string values, so it must not contain
	# anything JSON would have to escape — nor sed's own metacharacters.
	case "$NATIVE_CAVEMAN_PATH" in
	*'"'* | *'\'* | *'|'* | *'&'* | *$'\n'*)
		warn "caveman plugin path contains a character that is unsafe to substitute ($NATIVE_CAVEMAN_PATH) — skipping plugin registry rewrite"
		return
		;;
	esac

	while IFS= read -r -d '' file; do
		grep -qF "$DOCKER_CAVEMAN_PATH" "$file" 2>/dev/null || continue
		act "rewrite $DOCKER_CAVEMAN_PATH -> $NATIVE_CAVEMAN_PATH in $(as_target_path "$file")"
		JSON_REWRITTEN=$((JSON_REWRITTEN + 1))
		((DRY_RUN)) && continue

		tmp="$file.migrate.tmp"
		cp -p "$file" "$tmp" # carries the original mode (0600) onto the temp
		LC_ALL=C sed "s|$DOCKER_CAVEMAN_PATH|$NATIVE_CAVEMAN_PATH|g" "$file" >"$tmp"
		# sqlite3 is already a hard dependency, so it doubles as the JSON
		# validator — no python/node needed just to prove the edit is sound.
		# The CAST matters: readfile() returns a BLOB, and json_valid() reads
		# a BLOB as JSONB, which valid JSON text is not.
		if [[ "$(sqlite3 :memory: "SELECT json_valid(CAST(readfile('$(sql_escape "$tmp")') AS TEXT));" 2>/dev/null)" == "0" ]]; then
			rm -f "$tmp"
			die "rewriting $file would have produced invalid JSON; left untouched"
		fi
		mv "$tmp" "$file"
	done < <(find "$SCAN_ROOT" -type f -name installed_plugins.json -print0 2>/dev/null)

	log "  plugin registries rewritten: $JSON_REWRITTEN"
}

# ---------------------------------------------------------------------------
# Deliberate omissions
# ---------------------------------------------------------------------------

report_skipped() {
	step "Not migrated (on purpose)"

	local default_dir="$DATA_ROOT/default"
	if [[ ! -d $default_dir ]]; then
		log "  (no $default_dir in the source data root)"
		return
	fi

	local entry name
	for entry in "$default_dir"/*; do
		[[ -e $entry ]] || continue
		name="$(basename "$entry")"
		case "$name" in
		playwright)
			log "  default/playwright — linux/arm64 Chromium from the image; it cannot execute on this host. The in-app browser runtime downloads a native build on first use."
			;;
		claude | codex | cursor | opencode-config | opencode-data | cloudcli)
			log "  default/$name — config dir of the container's own account. Natively, profile-less sessions use your real ~/.$name, which already holds your logins."
			;;
		app-state)
			log "  default/app-state — app state of the container user's home; the native service keeps its own under your home."
			;;
		*)
			log "  default/$name — container-only home state, not part of the native layout."
			;;
		esac
	done
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

summary() {
	step "Summary"
	if ((DRY_RUN)); then
		log "  DRY RUN — nothing was copied, rewritten, or removed."
	fi
	log "  database:  $SRC_DB -> $DST_DB"
	log "  backup:    $SRC_DB.pre-migrate (source left in place, untouched)"
	if [[ -d $SRC_PROFILES ]]; then
		log "  profiles:  $SRC_PROFILES -> $DST_PROFILES"
	fi
	log "  path map:  $MAP_FROM -> $MAP_TO"
	log "  links:     $LINKS_REPAIRED re-pointed at $CHECKOUT/skills, $LINKS_REMOVED removed, $LINKS_LEFT_ALONE untouched"
	log "  plugins:   $JSON_REWRITTEN registry file(s) now point at $NATIVE_CAVEMAN_PATH"

	step "Next steps"
	if ((DRY_RUN)); then
		log "  1. Re-run without --dry-run to perform the migration."
		return
	fi
	cat <<EOF
  1. Start the service:
       macOS:  launchctl bootstrap gui/\$UID ~/Library/LaunchAgents/ai.rfc-code.server.plist
       Linux:  systemctl --user start rfc-code
  2. Open the UI and check that each profile still shows as authenticated
     (a profile that lost its credentials just needs a fresh login).
  3. Open a session from before the migration and confirm its project path
     resolves — that is the rewrite above proving itself end to end.
  4. Once satisfied, the old container and its data root can go — in the
     checkout you used to run it from:
       docker compose -f deploy/docker-compose.yml down
     Keep $SRC_DB.pre-migrate until then.
EOF
}

main() {
	parse_args "$@"
	parse_projects_map

	SRC_DB="$DATA_ROOT/db/auth.db"
	SRC_PROFILES="$DATA_ROOT/profiles"

	DST_ROOT="${TARGET_ROOT:-$HOME/.rfc-code/data}"
	# The native home is the target root's parent, so --target-root moves the
	# whole native layout (including the caveman clone path recorded in profile
	# plugin registries) together instead of leaving half of it under $HOME.
	RFC_HOME="$(dirname "$DST_ROOT")"
	DST_DB_DIR="$DST_ROOT/db"
	DST_DB="$DST_DB_DIR/auth.db"
	DST_PROFILES="$DST_ROOT/profiles"
	NATIVE_CAVEMAN_PATH="$RFC_HOME/caveman-plugin"
	PORT="$(resolve_port)"

	log "RFC Code — Docker to native migration"
	log "  source:  $DATA_ROOT"
	log "  target:  $DST_ROOT"
	log "  checkout: $CHECKOUT"
	((DRY_RUN)) && log "  mode:    DRY RUN (nothing is written)"

	preflight
	copy_data
	rewrite_paths
	repair_profiles
	report_skipped
	summary
}

main "$@"
