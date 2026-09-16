/**
 * Source of the PreToolUse guard installed into each Claude profile.
 *
 * Kept as a string so the server build (plain `tsc`, no asset copying) ships
 * it; `applyCodegraphHooks` materializes it under the profile's `hooks/` dir.
 */

export const CODEGRAPH_GUARD_SCRIPT_NAME = 'codegraph-guard.sh';

export const CODEGRAPH_GUARD_SCRIPT = `#!/usr/bin/env bash
# PreToolUse guard for Bash: in a CodeGraph-indexed repo, deny shell code
# searches (grep/rg/ag/find) and point Claude at codegraph_explore instead.
# Allows searches over non-indexed content (.env, JSON, Markdown, YAML, TOML,
# SQL, node_modules, dist), \`rtk proxy\`, and grep used as a pipe filter.
# Managed by rfc-code (applyCodegraphHooks); local edits are preserved.

set -u

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty')"
[ -z "$cmd" ] && exit 0
[ -z "$cwd" ] && cwd="$PWD"

# Only care when a search tool STARTS a command (not \`npm test | grep pass\`).
# Accepts an optional \`rtk \` prefix, since the rtk hook rewrites grep -> rtk grep.
search_re='(^|[;&|(]|\\$\\()[[:space:]]*(rtk[[:space:]]+)?(grep|egrep|fgrep|rg|ag|find)([[:space:]]|$)'
printf '%s' "$cmd" | grep -Eq "$search_re" || exit 0

# Pipe filters: the search tool follows a \`|\` -> it reads command output, not code.
if printf '%s' "$cmd" | grep -Eq '\\|[[:space:]]*(rtk[[:space:]]+)?(grep|egrep|fgrep|rg|ag)([[:space:]]|$)' \\
   && ! printf '%s' "$cmd" | grep -Eq '^[[:space:]]*(rtk[[:space:]]+)?(grep|egrep|fgrep|rg|ag|find)([[:space:]]|$)'; then
  exit 0
fi

# Explicit escape hatch and non-indexed content.
case "$cmd" in
  *"rtk proxy"*) exit 0 ;;
esac
if printf '%s' "$cmd" | grep -Eq '\\.env|\\.json|\\.md|\\.ya?ml|\\.toml|\\.sql|\\.lock|node_modules|/dist|\\.taskmaster|\\.codegraph|\\.claude|/tmp/|~/'; then
  exit 0
fi

root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")"
[ -d "$root/.codegraph" ] || exit 0

reason="This repo is CodeGraph-indexed ($root/.codegraph). Use codegraph_explore (MCP; load via ToolSearch if deferred) or \\\`codegraph explore \\"<symbols or question>\\"\\\` instead of grep/rg/find for code questions. Shell search is fine for non-indexed content (.env, JSON, Markdown, YAML, SQL) or via \\\`rtk proxy\\\`."
jq -cn --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
`;
