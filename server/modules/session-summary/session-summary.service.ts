/**
 * Builds the compact "what happened" view of a session for external agents.
 *
 * Reads the live run registry first (status, timings, buffered events) and
 * falls back to persisted state (transcript history, recorded failures) once
 * the run buffer has been evicted, so the same call works seconds or hours
 * after a turn ended.
 */

import path from 'node:path';

import { projectsDb, sessionRunFailuresDb, sessionsDb, type SessionRow } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { NormalizedMessage } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { collectGitSummary, type GitRunner } from './session-summary-git.js';
import { detectTestRun } from './session-summary-tests.js';
import {
  MAX_SUMMARY_RESPONSE_CHARS,
  type SessionSummary,
  type SessionSummaryPendingApproval,
  type SessionSummaryProject,
  type SessionSummaryStatus,
} from './session-summary.types.js';

export type SessionSummaryRuntime = {
  /** Same lookup the chat gateway receives; keyed by the provider-native session id. */
  getPendingApprovalsForSession(providerSessionId: string): unknown[];
};

export type SessionSummaryDeps = {
  gitRunner?: GitRunner;
  /** Transcript fallback when the run buffer is gone; defaults to the sessions service. */
  fetchHistory?(sessionId: string): Promise<{ messages: NormalizedMessage[] }>;
};

let runtime: SessionSummaryRuntime | null = null;

/** Wired once by the entrypoint; until then no approval can be reported. */
export function configureSessionSummaryRuntime(deps: SessionSummaryRuntime): void {
  runtime = deps;
}

type LiveRun = NonNullable<ReturnType<typeof chatRunRegistry.getRun>>;

function readAssistantText(events: NormalizedMessage[]): string {
  const read = (event: NormalizedMessage): string =>
    typeof event.content === 'string' ? event.content : typeof event.text === 'string' ? event.text : '';
  const texts = events.filter((event) => event.kind === 'text' && event.role === 'assistant').map(read).filter(Boolean);
  if (texts.length > 0) return texts.join('\n\n');
  return events.filter((event) => event.kind === 'stream_delta').map(read).join('');
}

/** Keeps the tail: the final answer of a turn is at the end, after any narration. */
function truncate(text: string): { response: string | null; responseTruncated: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { response: null, responseTruncated: false };
  if (trimmed.length <= MAX_SUMMARY_RESPONSE_CHARS) return { response: trimmed, responseTruncated: false };
  return { response: `…${trimmed.slice(-(MAX_SUMMARY_RESPONSE_CHARS - 1))}`, responseTruncated: true };
}

const MAX_APPROVAL_DESCRIPTION_CHARS = 300;
const MAX_ERROR_CHARS = 500;
/** Transcript tail read when the run buffer is gone; a turn rarely spans more frames than this. */
const HISTORY_TAIL_MESSAGES = 60;

function cap(text: string | null, max: number): string | null {
  if (text === null) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function resolveProject(session: SessionRow): SessionSummaryProject {
  const projectPath = session.project_path;
  const row = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const custom = row?.custom_project_name?.trim();
  return {
    id: row?.project_id ?? null,
    name: custom || path.basename(projectPath ?? '') || (projectPath ?? 'unknown'),
    path: projectPath,
  };
}

function firstPendingApproval(session: SessionRow, run: LiveRun | undefined): SessionSummaryPendingApproval | null {
  const providerId = run?.providerSessionId ?? session.provider_session_id;
  if (!providerId || !runtime) return null;
  const [approval] = runtime.getPendingApprovalsForSession(providerId);
  if (!approval || typeof approval !== 'object') return null;
  const record = approval as { requestId?: unknown; toolName?: unknown; input?: unknown };
  const toolName = typeof record.toolName === 'string' ? record.toolName : null;
  const command = record.input && typeof record.input === 'object' ? (record.input as { command?: unknown }).command : undefined;
  const description = toolName ? (typeof command === 'string' ? `${toolName}: ${command}` : toolName) : null;
  return {
    requestId: typeof record.requestId === 'string' ? record.requestId : String(record.requestId ?? ''),
    toolName,
    description: cap(description, MAX_APPROVAL_DESCRIPTION_CHARS),
  };
}

/** The terminal frame of a buffered run, when it already ended. */
function completionOf(run: LiveRun): NormalizedMessage | undefined {
  return [...run.events].reverse().find((event) => event.kind === 'complete');
}

/** A failure recorded for a run that ended after the session row was last touched. */
function persistedFailure(session: SessionRow): string | null {
  const failures = sessionRunFailuresDb.listBySession(session.session_id);
  const newest = failures[failures.length - 1];
  if (!newest) return null;
  const failedAt = Date.parse(newest.failed_at);
  const updatedAt = Date.parse(session.updated_at ?? '');
  if (Number.isFinite(failedAt) && Number.isFinite(updatedAt) && failedAt < updatedAt) return null;
  return newest.error_message;
}

function deriveStatus(
  run: LiveRun | undefined,
  pending: SessionSummaryPendingApproval | null,
  session: SessionRow,
): { status: SessionSummaryStatus; error: string | null } {
  if (run?.status === 'running') {
    return { status: pending ? 'waiting_approval' : 'running', error: null };
  }
  if (pending) return { status: 'waiting_approval', error: null };
  if (run) {
    const complete = completionOf(run);
    const exitCode = typeof complete?.exitCode === 'number' ? complete.exitCode : 0;
    if (exitCode !== 0 && !complete?.aborted) {
      return { status: 'error', error: cap(run.lastErrorText || 'The run stopped without reporting a reason.', MAX_ERROR_CHARS) };
    }
    return { status: 'idle', error: null };
  }
  const failure = persistedFailure(session);
  return failure ? { status: 'error', error: cap(failure, MAX_ERROR_CHARS) } : { status: 'idle', error: null };
}

/** Assistant text of the last turn: everything after the last user message, same rule as the live buffer. */
function lastTurnText(messages: NormalizedMessage[]): string {
  let start = 0;
  messages.forEach((message, index) => {
    if (message.kind === 'text' && message.role === 'user') start = index + 1;
  });
  return readAssistantText(messages.slice(start));
}

async function historyText(sessionId: string, fetchHistory: NonNullable<SessionSummaryDeps['fetchHistory']>): Promise<string> {
  try {
    const { messages } = await fetchHistory(sessionId);
    return lastTurnText(messages);
  } catch {
    return '';
  }
}

/** Reads only the tail of the transcript: a summary poll must not parse a whole day of history. */
async function fetchHistoryTail(sessionId: string): Promise<{ messages: NormalizedMessage[] }> {
  const probe = await sessionsService.fetchHistory(sessionId, { limit: 1, offset: 0 });
  const offset = Math.max(0, probe.total - HISTORY_TAIL_MESSAGES);
  if (probe.total <= 1) return { messages: probe.messages };
  return sessionsService.fetchHistory(sessionId, { limit: HISTORY_TAIL_MESSAGES, offset });
}

export async function buildSessionSummary(
  input: { sessionId: string; sinceSeq?: number },
  deps: SessionSummaryDeps = {},
): Promise<SessionSummary> {
  const session = sessionsDb.getSessionById(input.sessionId);
  if (!session) {
    throw new AppError(`Session "${input.sessionId}" was not found.`, { code: 'SESSION_NOT_FOUND', statusCode: 404 });
  }

  const run = chatRunRegistry.getRun(session.session_id);
  const pending = firstPendingApproval(session, run);
  const { status, error } = deriveStatus(run, pending, session);

  const events = run ? chatRunRegistry.replayEvents(session.session_id, input.sinceSeq ?? 0) : [];
  const liveText = readAssistantText(events);
  const fetchHistory = deps.fetchHistory ?? fetchHistoryTail;
  const text = liveText || (run ? '' : await historyText(session.session_id, fetchHistory));

  const startedAt = run ? new Date(run.startedAt).toISOString() : null;
  const finishedAt = run?.completedAt ? new Date(run.completedAt).toISOString() : null;
  const cwd = session.worktree_path ?? session.project_path ?? null;

  return {
    sessionId: session.session_id,
    provider: session.provider,
    project: resolveProject(session),
    status,
    startedAt,
    finishedAt,
    durationMs: run ? (run.completedAt ?? Date.now()) - run.startedAt : null,
    lastSeq: run?.lastSeq ?? 0,
    pendingApproval: pending,
    error,
    ...truncate(text),
    git: await collectGitSummary(cwd, deps.gitRunner),
    tests: detectTestRun(events),
  };
}
