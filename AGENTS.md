# Agent Instructions

Shared instructions for any coding agent working in this repo (Claude Code,
Codex, Cursor, etc). Tool-specific files should import or mirror this content
instead of duplicating it.

## CodeGraph — default tool for code understanding

This repo has `.codegraph/` indexed and kept in sync by a file-watching daemon.
Use `codegraph_explore` (MCP, when available) or `codegraph explore "<query>"`
(shell — works from any agent/terminal) BEFORE grep/find/reading files
whenever the task is one of:

- **Blast radius before editing** — check callers/dependents of a function or
  type before changing it.
- **Dead code / untested surface** — spot symbols with no callers or no
  covering tests (flagged in explore output).
- **Cross-layer flow** — trace route → service → DB (or component → hook →
  API) without opening every file by hand.
- **Dynamic dispatch** — callbacks, React re-render chains, JSX children —
  edges grep cannot follow.
- **Onboarding to an unfamiliar area** — "how does X work" in one capped call.
- **Safe rename/refactor** — list every caller of a symbol before renaming it.

Skip it only for non-indexed content (SQL, config, docs, `.env`) or when
`.codegraph/` is absent.
