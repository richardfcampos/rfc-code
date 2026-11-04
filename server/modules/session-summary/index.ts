/**
 * Public surface of the session summary module: one compact view of a
 * session for the `session_summary` MCP tool, the `rfc` CLI and the session
 * webhook payload.
 */

export { buildSessionSummary, configureSessionSummaryRuntime } from './session-summary.service.js';
export type { SessionSummaryDeps, SessionSummaryRuntime } from './session-summary.service.js';
export { detectTestRun } from './session-summary-tests.js';
export { collectGitSummary } from './session-summary-git.js';
export type { GitRunner } from './session-summary-git.js';
export { MAX_SUMMARY_FILES, MAX_SUMMARY_RESPONSE_CHARS } from './session-summary.types.js';
export type {
  SessionSummary,
  SessionSummaryCommit,
  SessionSummaryGit,
  SessionSummaryPendingApproval,
  SessionSummaryProject,
  SessionSummaryStatus,
  SessionSummaryTests,
} from './session-summary.types.js';
