/**
 * Contract of the session summary: the one compact view of "what happened in
 * this session" shared by the `session_summary` MCP tool, the `rfc` CLI and the
 * session webhook payload. Keep it small — every byte here is paid for by an
 * external agent on each poll.
 */

export type SessionSummaryStatus = 'running' | 'idle' | 'waiting_approval' | 'error';

export type SessionSummaryProject = {
  id: string | null;
  name: string;
  path: string | null;
};

export type SessionSummaryPendingApproval = {
  requestId: string;
  toolName: string | null;
  /** Short, human-readable line, e.g. `Bash: rm -rf dist`. */
  description: string | null;
};

export type SessionSummaryCommit = {
  hash: string;
  message: string;
};

export type SessionSummaryGit = {
  branch: string | null;
  /** The last line of `git diff --stat HEAD`, e.g. `3 files changed, 41 insertions(+)`. */
  diffStat: string | null;
  /** Changed (tracked) file paths, capped at `MAX_SUMMARY_FILES`. */
  files: string[];
  filesTruncated: boolean;
  untracked: number;
  lastCommit: SessionSummaryCommit | null;
};

export type SessionSummaryTests = {
  runner: 'node:test' | 'vitest' | 'jest' | 'pytest' | 'phpunit' | 'unknown';
  passed: number | null;
  failed: number | null;
  total: number | null;
};

export type SessionSummary = {
  sessionId: string;
  provider: string;
  project: SessionSummaryProject;
  status: SessionSummaryStatus;
  /** ISO timestamps of the last run; null when the session never ran in this process. */
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  lastSeq: number;
  pendingApproval: SessionSummaryPendingApproval | null;
  /** Last error text when `status` is `error`. */
  error: string | null;
  /** Assistant text of the last turn, truncated to `MAX_SUMMARY_RESPONSE_CHARS`. */
  response: string | null;
  responseTruncated: boolean;
  git: SessionSummaryGit | null;
  /** null when no test run was detected in the turn's tool output. */
  tests: SessionSummaryTests | null;
};

export const MAX_SUMMARY_RESPONSE_CHARS = 1500;
export const MAX_SUMMARY_FILES = 40;
