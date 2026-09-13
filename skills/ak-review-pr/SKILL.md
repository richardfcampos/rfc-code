---
name: ak:review-pr
description: "Review one or more GitHub pull requests thoroughly — analyze diffs for correctness, security, breaking changes, code quality, and AI-slop patterns. Accepts multiple PR refs in one call. Auto-detects environments where the GitHub GraphQL API is blocked (e.g. Claude Cloud Environment) and falls back to REST (`gh api repos/{owner}/{repo}/...`). Supports --fix to auto-remediate findings, --reply to post the review back to GitHub, and --merge to merge a ready PR and watch post-merge CI to green."
user-invocable: true
when_to_use: "Invoke to review one or more GitHub PRs by number/URL, optionally fix findings, optionally post the review back to GitHub, optionally merge when ready and watch CI."
category: utilities
keywords: [pr, pull request, review, github, gh, fix, reply, merge, ci, anti-slop, ai-slop, multi-pr, graphql, rest, cloud-environment]
argument-hint: "<PR number or URL> [<PR number or URL> ...] [--fix] [--reply] [--merge] [--advice] [--ultra]"
allowed-tools:
  - Bash(gh pr view *)
  - Bash(gh pr diff *)
  - Bash(gh pr checks *)
  - Bash(gh pr review *)
  - Bash(gh pr comment *)
  - Bash(gh pr merge *)
  - Bash(gh pr list *)
  - Bash(gh run view *)
  - Bash(gh run list *)
  - Bash(gh run watch *)
  - Bash(sleep *)
  - Bash(gh api *)
  - Bash(gh auth status *)
  - Bash(source *)
  - Bash(. *)
  - Bash(command *)
  - Bash(git log *)
  - Bash(git fetch *)
  - Bash(git diff *)
  - Bash(git status *)
  - Bash(git branch *)
  - Bash(git rev-parse *)
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(git push *)
  - Bash(date *)
  - Read
  - Edit
  - MultiEdit
  - Write
  - Glob
  - Grep
  - Task
metadata:
  author: agentkit
  version: "2.5.0"
---

# Review Pull Request

Review PR(s) `$ARGUMENTS` in this repository.

## Modes

- **Review-only** (default): review the PR(s) and print findings to chat. Do not edit, commit, or push.
- **Fix loop** (`--fix`): review, fix all actionable findings, commit+push, then re-review. Repeat until no actionable findings remain.
- **Reply** (`--reply`): after the review (or after the fix loop converges), post the review back to the PR via `gh pr review`.
- **Merge** (`--merge`): after all other modes complete, if the PR is ready to merge, activate `ak:git merge-pr` to merge it, watch post-merge CI until green, and verify follow-up before stopping.
- **Advice** (`--advice`): run under `kongming` advisory supervision (see Advisory supervision).
- **Ultra** (`--ultra`): run each PR's initial review as a best-of-5 verifier pass (see Ultra Verifier Mode).

Flags compose: `review-pr 123 --fix --reply` runs the fix loop and posts the final re-review at the end. `review-pr 123 --fix --reply --merge` additionally merges once the loop converges on Approve. `--advice` layers on top of any combination. Flag order does not matter.

## Multi-PR mode

`$ARGUMENTS` may name multiple PRs at once (e.g. `123 456 https://github.com/o/r/pull/789`). Every non-flag token is one PR reference. Accepted forms per token: bare number (`123`), `#123`, or a full PR URL. Tokens may be whitespace- or comma-separated.

Execution is **sequential per PR**. For each PR ref in `PR_REFS`, run the full flow (Instructions → Fix loop → Reply → Merge → Advice checkpoints) end-to-end before moving to the next. This keeps verdicts, commits, replies, and merge results deterministic and easy to attribute in the final report.

Fail-fast is off by default — a fatal error on one PR (e.g. PR not found, GraphQL+REST both denied, merge-readiness rejected) records the failure in the per-PR summary and continues with the next PR. Only stop the whole run when an unrecoverable environment failure occurs (`gh` not installed, no auth at all).

Single-PR invocations continue to behave exactly as before; `PR_REFS` just contains one element.

## GitHub API compatibility

Some hosted environments (notably Claude Cloud Environment) block the GitHub GraphQL API at the egress proxy. `gh pr view`, `gh pr diff`, `gh pr checks`, and `gh pr list` all issue GraphQL under the hood and error with:

```
HTTP 403: This GraphQL query is not enabled for this session — only the pinned set of PR-review operations is served. Use REST via `gh api repos/{owner}/{repo}/...` instead.
```

A single shell library — `references/gh-api-helpers.sh` — owns the probe and every adaptive command. Source it at the top of every per-PR bash block in this skill with the multi-install-path loader below. The ladder covers project-scoped installs (`.claude/skills/…`), user-scoped installs (`~/.claude/skills/…`), the AgentKit monorepo checkout (`kits/core/skills/…`), and a plugin-delivered install (`${CLAUDE_PLUGIN_ROOT}/skills/…`) — the last rung is a best-effort fallback: it fires when `CLAUDE_PLUGIN_ROOT` reaches the shell either as an exported env var or via literal placeholder substitution in this file's own text, whichever the runtime provides. If none of the four rungs resolve, the block fails fast with an explicit "not found" error instead of sourcing an unchecked path.

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/core/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
```

Functions the library exports (all safe to call many times per run):

| Function                                | Purpose                                                                                     |
|-----------------------------------------|---------------------------------------------------------------------------------------------|
| `_ak_probe_gh_api`                      | One-shot GraphQL availability probe. Sets `AK_GH_REST=1` when GraphQL is blocked.           |
| `_ak_split_pr <ref>`                    | Splits `123` / `#123` / full PR URL into `OWNER REPO NUMBER`. Uses `git remote`, no API.    |
| `_ak_pr_meta OWNER REPO NUMBER`         | JSON metadata — mirrors `gh pr view --json …`. GraphQL native or REST fallback.             |
| `_ak_pr_diff OWNER REPO NUMBER`         | Unified diff. GraphQL native or REST via `Accept: application/vnd.github.v3.diff`.          |
| `_ak_pr_files OWNER REPO NUMBER`        | Changed file list, one path per line.                                                       |
| `_ak_pr_checks OWNER REPO NUMBER`       | CI check summary — `<name>\t<status>\t<conclusion>\t<url>` per run; `No checks found` else. |
| `_ak_pr_body OWNER REPO NUMBER`         | PR body text — feeds `pr-body-contract.cjs` on stdin.                                       |
| `_ak_pr_review OWNER REPO NUMBER EVENT` | Formal review from stdin. `EVENT` ∈ `APPROVE`, `REQUEST_CHANGES`, `COMMENT`. Native → REST. |
| `_ak_pr_comment OWNER REPO NUMBER`      | Post an issue/PR comment from stdin. Native → REST.                                         |

The probe is silent by design; the library never fails hard on probe failure — it falls back to REST as if GraphQL were blocked. Write helpers (`_ak_pr_review`, `_ak_pr_comment`) skip the native attempt when the probe already reports `AK_GH_REST=1`; when the probe reports GraphQL available they try native `gh pr …` first (the proxy's "pinned set of PR-review operations" allowlist accepts most write ops) and only fall back to REST if the native call fails.

### Merge write op

`gh pr merge` is handled by `ak:git merge-pr`. This PR updates that workflow (`kits/core/skills/ak-git/references/workflow-merge-pr.md`) to source the same `gh-api-helpers.sh` loader for its readiness-gate reads (`gh pr view`, `gh pr checks`, `gh pr list`) and to fall back to `gh api -X PUT repos/{o}/{r}/pulls/{n}/merge -f merge_method=…` when GraphQL is blocked.

Important gap: GitHub's auto-merge enable is **GraphQL-only** (`enablePullRequestAutoMerge`) with no REST endpoint. When `AK_GH_REST=1`, the merge-pr workflow degrades from "merge with `--auto` while checks pending" to "poll checks until terminal-green, then `PUT /pulls/{n}/merge`". That's documented in the merge-pr workflow, not here.

### Self-PR approve

Approving your own PR returns HTTP 422 under both native and REST. The fallback rule in Reply mode step 4 applies to both paths (downgrade to `COMMENT`).

## Argument parsing

Strip mode flags, then tokenize the remainder into `PR_REFS`:

```
!`ARGS_STRIPPED="$(printf '%s' "$ARGUMENTS" | sed -E 's/[[:space:]]*--(fix|reply|merge|advice|ultra)([[:space:]]+|$)/ /g; s/,/ /g; s/^[[:space:]]+//; s/[[:space:]]+$//')" && PR_REFS="$ARGS_STRIPPED" && PR_COUNT="$(printf '%s\n' "$PR_REFS" | awk '{print NF}')" && printf 'PR_REFS=%s\nPR_COUNT=%s\n' "$PR_REFS" "$PR_COUNT"`
```

Detect flags (the substring match below is intentional — flags may appear in any order):

- `--fix` present → fix-loop mode active
- `--reply` present → reply mode active
- `--merge` present → merge mode active
- `--advice` present → advisory supervision active
- `--ultra` present → ultra verifier mode active for each PR's initial review

Within the Instructions loop, `PR_REF` is the current iteration's ref; the singular name is preserved so this section's examples and the rest of the doc read the same in both single- and multi-PR modes.

## Advisory supervision (`--advice`)

When `--advice` is present, run this skill under `kongming` supervision.
Load `../ak-brainstorm/references/advisory-supervision.md` for supervisor
identity, host detection, and model routing (Claude subscription → Fable 5;
Codex → `gpt-5.6-sol` + high effort; Cursor → `claude-fable-5-high`).

Spawn `kongming` at these checkpoints (**per PR**, not once per run):

- **After the initial review completes** — pass the PR reference, the diff
  summary, the findings list with severities, and the tentative verdict; ask
  for a go/no-go on the verdict, missed findings, and — when `--fix` is set —
  which findings are actually worth fixing versus over-reach.
- **When the `--fix` loop is stuck** — same finding survives 3 attempts,
  `ak:fix` is blocked, or CI keeps reding for the same reason; pass every
  approach already tried, the exact failure, and ask for a new angle or a
  legitimate stop condition.
- **Before posting `--reply`** — pass the final review body (summary, risk
  level, findings, verdict) and ask kongming to sanity-check tone, evidence,
  and severity assignments before the review lands on GitHub. If kongming
  flags a Critical/Important issue with the body, revise before posting; do
  not treat kongming counsel as a veto on the verdict itself.
- **Before triggering `--merge`** — pass the merge-readiness evidence
  (verdict, `reviewDecision`, `mergeable`, CI status, blockers) and ask for a
  risk sanity check before authorizing the merge. Do not weaken the
  merge-readiness gate documented under Merge mode.
- **MANDATORY after the PR is open AND CI is terminal-green** — spawn
  `kongming` to review the whole implementation (diff + PR body + linked
  issue when one exists), then post its assessment plus concrete next steps
  as a comment directly on the PR via the adaptive write helper
  (`_ak_pr_comment "$OWNER" "$REPO" "$NUMBER"`; see GitHub API
  compatibility). Append the same-style traceability footer used by
  `--reply` so the source is obvious. This gate fires once per PR after
  that PR's CI-green
  transition; it does not run per fix-loop iteration. When `--merge` is
  present, the transition happens inside Merge mode step 2. When `--merge`
  is absent, fire this gate at the end of the PR's iteration if
  `_ak_pr_checks` is terminal-green; otherwise skip it and note the reason
  (CI red, pending, or unavailable) in the Final output.

**Empty-counsel fallback**: if `kongming` returns an empty final message,
errors, or is otherwise unreachable, record the failure in chat and continue
with the review/fix/reply/merge flow. Never fail the whole skill on a missing
advisory step.

**Forward-carry in the fix loop**: when `--advice` was originally set, the
`--fix` re-invocation of this skill must carry `--advice` forward alongside
`--reply` and `--merge` so supervision persists across iterations.

`--advice` adds supervision; it never bypasses this skill's approval gates,
tests, code-review blockers, branch protections, or security policy. When the
review verdict is authoritative under Modes/Findings rules, kongming counsel
informs the write-up and the decision; it does not override the verdict.

## Ultra Verifier Mode (`--ultra`)

When `--ultra` is present, run the **initial review of each PR** as a best-of-5
verifier pass. The controller assembles one immutable evidence packet per PR —
the diff, PR body, linked issue, and CI status — plus the review rubric,
dispatches exactly five independent read-only candidate reviews in one parallel
wave, then a single strongest-model verifier validates the findings.

- **Candidate task:** each candidate performs the full review of the same PR
  evidence packet and returns its findings list with severities and cited
  evidence. Candidates never comment, commit, or call `gh` mutations.
- **Finalizer:** the verifier returns the evidence-validated, deduplicated union
  of findings across the five reviews — it never selects one review wholesale,
  because a real defect may appear in only one candidate. It drops findings it
  cannot validate against cited evidence and merges duplicates; ranking orders
  severity and confidence only.
- The fix/reply/merge flow then runs once on that union; re-reviews in the
  fix loop stay single-pass. Multi-PR mode fans per PR, still sequentially
  across PRs.

Full mechanics — anonymization, the five-usable-candidate gate, reject-all, and
the fail-closed runtime rule — are in
`../ak-brainstorm/references/ultra-verifier-mode.md`. It is a best-of-5
verifier mode inspired by LLM-as-a-Verifier, not the full framework.

## Context

Detected PRs and API mode (prelude — heavy metadata loads per-PR inside Instructions):

```
!`_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh; [ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"; [ -f "$_ak_lib" ] || _ak_lib=kits/core/skills/ak-review-pr/references/gh-api-helpers.sh; [ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }; [ -f "$_ak_lib" ] && . "$_ak_lib" && _ak_probe_gh_api 2>/dev/null; ARGS_STRIPPED="$(printf '%s' "$ARGUMENTS" | sed -E 's/[[:space:]]*--(fix|reply|merge|advice|ultra)([[:space:]]+|$)/ /g; s/,/ /g; s/^[[:space:]]+//; s/[[:space:]]+$//')"; PR_REFS="$ARGS_STRIPPED"; printf 'PR_REFS: %s\nAK_GH_REST: %s (%s)\nLIB: %s\n' "$PR_REFS" "${AK_GH_REST:-?}" "$( [ "${AK_GH_REST:-0}" = 1 ] && echo 'GraphQL blocked — REST fallback active' || echo 'GraphQL available — native gh pr commands preferred' )" "${_ak_lib:-not-found}"`
```

## Instructions

Perform a thorough code review of **each PR listed in `PR_REFS`**, one at a time. For each `PR_REF`, run steps 0–4 below, then continue into Fix loop / Reply / Merge modes if their flags are set, then move to the next PR ref.

### 0. Resolve writing language and per-PR context

```bash
WL_BIN=.claude/hooks/lib/writing-language.cjs
test -f "$WL_BIN" || WL_BIN=kits/core/hooks/lib/writing-language.cjs
node "$WL_BIN" --json
```

Load `references/writing-language.md`. Author Summary, Risk level, Findings,
Verdict, blocker/handoff text, and reply prose in that language. Keep severity
labels and GitHub review mechanics (`--approve` / `--request-changes` /
`--comment`) independent of language. If `fallbackReason` is set, note the
fallback in the review body.

Also load `references/pr-body-contract.md` and validate the PR description
(adaptive — `_ak_pr_body` respects `AK_GH_REST`):

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/core/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
read OWNER REPO NUMBER < <(_ak_split_pr "$PR_REF")
PR_BIN=.claude/hooks/lib/pr-body-contract.cjs
test -f "$PR_BIN" || PR_BIN=kits/core/hooks/lib/pr-body-contract.cjs
_ak_pr_body "$OWNER" "$REPO" "$NUMBER" | node "$PR_BIN"
```

Missing required evidence sections or unsupported claims → **Important**
findings. Do not encourage content padding; prefer honest gaps.

Load per-PR metadata, diff, and check status using the adaptive helpers (same
sourced library — safe to re-source per block):

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/core/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
read OWNER REPO NUMBER < <(_ak_split_pr "$PR_REF")
_ak_pr_meta   "$OWNER" "$REPO" "$NUMBER"
_ak_pr_diff   "$OWNER" "$REPO" "$NUMBER"
_ak_pr_files  "$OWNER" "$REPO" "$NUMBER" | head -50
_ak_pr_checks "$OWNER" "$REPO" "$NUMBER"
```

### 1. Understand the PR
- Read the PR title, description, and linked issues
- Understand the intent and scope of the changes
- Compare stated scope vs `additions`/`deletions`/`changedFiles` — a wide gap is itself a signal (see anti-slop reference)

### 2. Analyze the diff
- Read every changed file carefully
- For modified files, read the full file (not just the diff) to understand surrounding context
- Check if the changes align with the stated PR purpose

### 3. Check for issues

**Correctness**
- Logic errors, off-by-one, nil/null dereference
- Missing error handling or swallowed errors
- Race conditions in concurrent code
- Edge cases not handled

**Security**
- Injection (SQL, XSS, command, SSRF, path traversal)
- Hardcoded secrets or credentials
- Missing input validation at system boundaries
- Authentication/authorization gaps

**Breaking changes**
- API contract changes (request/response shapes, status codes)
- Database schema changes without migrations
- Config format changes without backwards compatibility
- Removed or renamed exports/public interfaces

**Code quality (anti-slop — terse checklist)**
LLM-assisted PRs commonly introduce code that *runs fine* but pollutes the codebase. Scan the diff for these high-signal patterns:

- New file in dumping-ground dirs (`utils/`, `helpers/`, `lib/common/`, `*manager.ts`) without a clear domain anchor
- Parallel reimplementation of a utility that already exists in the repo (grep for prior art)
- New abstraction (interface + factory + builder) with only one caller — premature
- New config flag for behavior that should be hardcoded
- Defensive paranoia — try/catch around code that cannot throw; null checks on typed-non-null params
- Catch-and-swallow — `catch (e) { console.log(e) }` or `catch { return null }`
- Over-comment — comments paraphrasing code (`// increment counter` next to `counter++`)
- One-line wrappers that add indirection with no value
- Re-implementing stdlib (`chunk`, `range`, `groupBy`) when language or existing dep covers it
- `any` widening, `@ts-ignore`, `// eslint-disable` introduced to silence (not fix) warnings
- Phantom test coverage — tests that exercise lines without meaningful assertions
- Unused imports / exports / parameters / variables introduced
- File grows past the project's size limit (commonly 200 lines) without splitting
- Diff size doesn't match scope ("fix typo" with +800/−60)
- Touches files unrelated to stated purpose
- Commit messages with generic LLM phrasing ("improve code quality and enhance maintainability")

**Load the full taxonomy** in `references/anti-ai-slop.md` when ANY of:
- diff adds >300 lines, OR
- ≥2 inline anti-slop flags above fire, OR
- PR creates >2 new files in `utils/`/`helpers/`/`lib/common/`, OR
- you cannot confidently judge whether a pattern is genuine YAGNI vs slop

The reference covers: structural slop, micro slop, process slop, how to phrase the finding without becoming an AI-witch-hunt, when NOT to flag, and stack-specific appendix (Go, React/TS, Tailwind).

**Project-specific compliance**
- Read the project's loaded instruction surfaces and follow its documentation navigation to locate current architecture, coding, data, UI, and review standards
- Verify every cited rule against the current path, source, tests, or configuration that owns it
- Check the diff against project conventions for: architecture patterns, ID scoping, SQL store rules, i18n catalogs, UI/CSS conventions, package manager, file-size limits
- See `references/project-rules-example.md` for a worked example of project-specific compliance rules (Go gateway, React/Tailwind UI)

**Testing**
- Are new code paths covered by tests?
- Do existing tests still pass with these changes?
- Are edge cases tested?
- Watch for phantom coverage (assertions that always pass)

### 4. Summarize findings

Present your review as:

**Summary**: 1-2 sentence overview of what the PR does.

**Risk level**: Low / Medium / High — based on scope, complexity, and breakage potential.

**Findings**: List issues found, categorized by severity:
- **Critical**: Must fix before merge (bugs, security, data loss)
- **Important**: Should fix (logic issues, missing validation, *structural* AI slop)
- **Suggestion**: Nice to have (style, minor improvements, *micro* AI slop)

> Anti-slop severity rule: **structural** slop (new dumping-ground file, parallel reimpl, abstraction with one caller, schema change without migration, large file growth) → **Important**. **Micro** slop (over-comments, defensive paranoia, one-line wrappers) → **Suggestion**. This keeps `--fix` from churning the diff with cosmetic rewrites the original author won't recognize.

**Verdict**: One of:
- **Approve** — No critical or important issues found
- **Request changes** — Critical or important issues need addressing
- **Comment** — Minor suggestions only, safe to merge as-is

## Fix loop mode (`--fix`)

If `$ARGUMENTS` contains `--fix`, follow this loop after the review steps above, **per PR**:

### 1. Decide whether fixing is needed

- If no actionable findings, stop and report **Approve** for this PR.
- Actionable = all **Critical** + **Important** findings, plus **Suggestion** findings that are concrete, low-risk, and tied to PR scope.
- Do not invent new style-only suggestions to keep the loop running.

### 2. Fix all findings

Activate `ak:fix --auto` with the full findings list and PR context:

```
ak:fix --auto "Fix all actionable findings from review-pr <PR_REF>: <finding summary>"
```

Pass the exact evidence:
- PR reference, base branch, head branch
- changed files
- each finding: severity, file path, line/function, expected behavior, actual behavior, why it matters
- constraints: preserve PR scope, avoid unrelated refactors, keep public contracts backward compatible unless the finding requires a contract change

`ak:fix` performs its own scout, diagnose, implementation, verification, and prevention flow. Do not bypass its hard gates.

### 3. Commit and push

After `ak:fix` verifies the fixes, activate:

```
ak:git cp
```

This stages, commits, and pushes the fixes to the PR head branch. Do not run `ak:git cp` if verification failed, secrets are detected, or the working tree contains unrelated user changes.

### 4. Re-review

After the push succeeds, activate `review-pr <PR_REF> --fix` again (carrying `--reply`, `--merge`, and `--advice` forward if they were originally set) and repeat the loop **for this PR only**. Do not advance to the next PR ref while the current fix loop is unresolved.

When `--advice` is originally set and the loop stalls (same finding survives 3 attempts, `ak:fix` blocked, CI unresolvable), spawn `kongming` at the "loop is stuck" checkpoint before declaring the stop condition — see Advisory supervision.

Stop only when one of:
- the re-review finds no actionable findings
- `ak:fix` is blocked by a missing user/business decision
- the same finding survives 3 consecutive fix attempts (loop not converging)
- CI or local verification fails in a way `ak:fix` cannot resolve without user input

Final output for `--fix` mode is captured per-PR in the Final output table:
- iteration count
- final verdict
- commits pushed
- remaining findings, if any
- blockers or unresolved questions

## Reply mode (`--reply`)

If `$ARGUMENTS` contains `--reply`, post the review back to GitHub as a formal review after the review (review-only) or after the fix loop converges (`--fix`), **per PR**.

### 1. Pre-flight checks

Run these checks. On any failure, **fall back to printing the review locally** and warn the user — never fail the whole skill:

```bash
command -v gh >/dev/null 2>&1 || { echo "gh CLI not installed — printing review locally"; exit 0; }
gh auth status >/dev/null 2>&1 || { echo "gh not authenticated — printing review locally"; exit 0; }
```

### 2. Build the review body

Construct the full markdown body containing the summary, risk level, findings (by severity), and verdict. Append a single-line footer for traceability:

```
*Posted by the installed review-pr skill at <ISO-8601 UTC timestamp>*
```

Use `date -u +"%Y-%m-%dT%H:%M:%SZ"` for the timestamp.

**Length cap**: GitHub limits comment bodies to ~65,536 chars. If the body exceeds 60,000 chars, truncate the *Findings* section and append `[truncated — N findings omitted; see local output]` so the reviewer knows to consult the full chat output.

### 3. Map verdict to gh flag

When `--advice` is originally set, run the "before posting `--reply`" checkpoint from Advisory supervision now: pass the final review body to `kongming`, apply any Critical/Important body revisions it flags (tone, missed evidence, mis-scoped severities), and only then post the review. Skip the checkpoint silently on the empty-counsel fallback.

Post via `_ak_pr_review` from the sourced helpers — it tries native `gh pr review` first and falls back to `gh api …/reviews` on the GraphQL-not-enabled error:

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/core/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
read OWNER REPO NUMBER < <(_ak_split_pr "$PR_REF")
# EVENT ∈ {APPROVE, REQUEST_CHANGES, COMMENT} — chosen from the verdict:
printf '%s\n' "$REVIEW_BODY" | _ak_pr_review "$OWNER" "$REPO" "$NUMBER" "$EVENT"
```

Verdict → `EVENT`:

| Verdict         | `EVENT`           |
|-----------------|-------------------|
| Approve         | `APPROVE`         |
| Request changes | `REQUEST_CHANGES` |
| Comment         | `COMMENT`         |

Pipe the body via stdin to avoid shell-quoting issues with backticks and code blocks.

### 4. Self-PR fallback

GitHub blocks approving your own PR under both native and REST paths. If the approve call exits non-zero with a self-review error (HTTP 422, message matching "Can not approve your own pull request"), retry with `EVENT=COMMENT`:

```bash
printf '%s\n' "$REVIEW_BODY" | _ak_pr_review "$OWNER" "$REPO" "$NUMBER" COMMENT
```

The review still lands in the timeline; the verdict text inside the body still reads "Approve". Note the downgrade in the chat output.

### 5. Composition with `--fix`

In `--fix --reply` mode, post **only the final re-review** when the loop converges. Iteration history lives in the commit log; the PR conversation stays clean.

If the loop terminates due to a blocker (non-converging, `ak:fix` blocked, CI unresolvable), still post the final review — but the verdict will reflect remaining findings (likely **Request changes** or **Comment**), and the body should include the blocker so the human reviewer knows where to take over.

### 6. Idempotency

V2 does not dedupe. Re-running `review-pr 123 --reply` posts a fresh review each time. The traceability footer (step 2) is the seed for future dedup work but is not consumed here.

## Merge mode (`--merge`)

If `$ARGUMENTS` contains `--merge`, run this stage LAST **for each PR** — after the review, after the fix loop converges (`--fix`), and after the review is posted (`--reply`). Complete the merge stage for the current PR before starting the next PR's flow.

When `--advice` is originally set, run the "before triggering `--merge`" checkpoint from Advisory supervision now — pass verdict, `reviewDecision`, `mergeable`, CI status, and any known blockers to `kongming`, treat its output as a risk sanity check, and proceed to the readiness gate below regardless of counsel presence (the gate is authoritative).

### 1. Merge-readiness gate

Merge ONLY when ALL of these hold for the current PR:

- Verdict is **Approve** (no Critical or Important findings; in `--fix` mode the loop converged with no actionable findings).
- The fix loop (if run) did not terminate on a blocker.
- PR is `OPEN` and `mergeable` (no conflicts): fetch via `_ak_pr_meta` and inspect `state`, `mergeable`, `reviewDecision` (native `--json state,mergeable,reviewDecision` fields; REST JSON has `state`, `mergeable`, and a separate `/reviews` call for the decision).
- `reviewDecision` is not `CHANGES_REQUESTED` from another reviewer.
- CI checks are all passing, or only pending (pending is acceptable — the merge step uses auto-merge).

If any condition fails, do NOT merge that PR. Record the PR as not-ready with the exact failed condition in the Final output, and move on to the next PR ref. `--merge` is an authorization to merge a ready PR, never an instruction to force an unready one through.

### 2. Merge and watch CI

Activate `ak:git merge-pr` with the current PR reference:

```
ak:git merge-pr <PR_REF>
```

`ak:git merge-pr` (documented in the `ak:git` skill) owns the mechanics:

- re-checks readiness with the same `gh-api-helpers.sh` loader (adaptive `_ak_pr_meta` / `_ak_pr_checks`), picks the repo's merge method, merges via `gh pr merge`; when GraphQL is blocked (`AK_GH_REST=1`) it polls checks to terminal-green and then falls back to `gh api -X PUT repos/{o}/{r}/pulls/{n}/merge -f merge_method=...` — REST has no auto-merge endpoint, so pending-checks mode degrades to poll-then-PUT
- watches post-merge CI on the target branch until every run for the merge commit concludes
- on deterministic CI failure, drives a follow-up fix (`ak:fix --auto` on a new branch) and repeats, up to 3 attempts
- verifies follow-up: PR state `MERGED`, merge commit on the target branch, all watched runs green
- closes the index row of a plan-backed change (matches the merged PR to its plan via `--linked-pr` or head branch, then `ak plan close`; skips silently when there is no plan) per the shared "Delivery finalization" protocol

Do not bypass its readiness gate or stop conditions. Do not advance to the next PR while the current PR's post-merge CI is still pending — a PR's run is complete only when its target-branch CI is green, an external blocker remains, or the fix attempts are exhausted.

When `--advice` is originally set AND post-merge target-branch CI reaches terminal-green for the current PR, run the MANDATORY post-CI-green checkpoint from Advisory supervision: spawn `kongming` to review the whole implementation, then post its assessment plus concrete next steps as a comment on the PR via `_ak_pr_comment` (native first, REST fallback):

```bash
_ak_lib=.claude/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || _ak_lib="${HOME:-}/.claude/skills/ak-review-pr/references/gh-api-helpers.sh"
[ -f "$_ak_lib" ] || _ak_lib=kits/core/skills/ak-review-pr/references/gh-api-helpers.sh
[ -f "$_ak_lib" ] || { (set +u; [ -n "${CLAUDE_PLUGIN_ROOT}" ]) && _ak_lib="${CLAUDE_PLUGIN_ROOT}/skills/ak-review-pr/references/gh-api-helpers.sh"; }
[ -f "$_ak_lib" ] || { echo "gh-api-helpers.sh not found" >&2; exit 1; }
. "$_ak_lib"
read OWNER REPO NUMBER < <(_ak_split_pr "$PR_REF")
printf '%s\n' "$KONGMING_BODY" | _ak_pr_comment "$OWNER" "$REPO" "$NUMBER"
```

Append the same-style traceability footer used by `--reply` (`*Posted by the installed review-pr skill at <ISO-8601 UTC timestamp>*`) so the source is obvious. The comment fires once per PR; do not repost per fix-loop iteration. Apply the empty-counsel fallback and honor the writing-language resolution from step 0.

### 3. Failure handling

- If `ak:git merge-pr` refuses (gate failure, branch protection, conflicts): record the blocker for this PR and continue with the next; do not retry with different flags to force the merge.
- If post-merge CI ends red after exhausted fix attempts or an external blocker: record the failing runs, the fixes attempted, and hand off to the user in the Final output.

## Final output

After every PR has completed its flow, report to the chat:

### Per-PR table

| PR | Verdict | Iterations | Commits | Reply | Merge | CI |
|----|---------|------------|---------|-------|-------|----|
| `<PR_REF>` | Approve / Request changes / Comment | N (if `--fix`) | list of SHAs (if `--fix`) | posted / fell-back / printed-locally (if `--reply`) | merged / not-ready(reason) / blocked (if `--merge`) | green / red / pending / n/a |

### Aggregate

- Total PRs processed and totals per verdict
- Environment: `AK_GH_REST=<0|1>` (native GraphQL vs REST fallback) and how many PRs actually hit the REST path
- Advisory summary if `--advice` ran: number of `kongming` checkpoints that fired across all PRs, whether each PR's MANDATORY post-CI-green comment was posted / skipped (with reason), and any advice-flagged risks that shaped verdicts or fix scope
- Remaining findings or blockers per PR
- Unresolved questions, if any
