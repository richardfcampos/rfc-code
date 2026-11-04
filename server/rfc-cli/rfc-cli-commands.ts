/**
 * One function per `rfc` subcommand. Each returns the structured value for
 * `--json` and the human text, so the entrypoint only decides which to print.
 * Every function talks to the server exclusively through `callTool`, which is
 * what makes the commands testable with a scripted client.
 */

import type { SessionSummary } from '@/modules/session-summary/index.js';

import { asArray, asNumber, asString, formatDuration, isRecord, keyValueLines, orDash, table, truncate } from './rfc-cli-render.js';

export type CallTool = (name: string, args?: Record<string, unknown>) => Promise<unknown>;
export type CommandOutput = { json: unknown; text: string };

const SESSION_TITLE_WIDTH = 40;
const MAX_LISTED_FILES = 40;

function requireRecord(value: unknown, tool: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${tool} returned an unexpected response.`);
  return value;
}

export async function runSend(callTool: CallTool, sessionId: string, content: string): Promise<CommandOutput> {
  const sent = requireRecord(await callTool('session_send', { sessionId, content }), 'session_send');
  const status = requireRecord(await callTool('session_status', { sessionId }), 'session_status');
  const lastSeq = asNumber(status.lastSeq) ?? 0;
  return {
    json: { sessionId, provider: asString(sent.provider), started: sent.started === true, lastSeq },
    text: `sent ${sessionId} seq=${lastSeq}`,
  };
}

function summaryLines(summary: SessionSummary): Array<[string, string]> {
  const project = summary.project?.name ?? '-';
  const approval = summary.pendingApproval
    ? summary.pendingApproval.description ?? summary.pendingApproval.toolName ?? summary.pendingApproval.requestId
    : 'none';
  const lines: Array<[string, string]> = [
    ['status', summary.status],
    ['project', project],
    ['branch', orDash(summary.git?.branch)],
    ['started', orDash(summary.startedAt)],
    ['duration', formatDuration(summary.durationMs)],
    ['lastSeq', String(summary.lastSeq ?? 0)],
    ['approval', approval],
  ];
  if (summary.error) lines.push(['error', truncate(summary.error, 200)]);
  return lines;
}

export async function runStatus(callTool: CallTool, sessionId: string): Promise<CommandOutput> {
  const summary = requireRecord(await callTool('session_summary', { sessionId }), 'session_summary') as unknown as SessionSummary;
  const { response: _response, responseTruncated: _truncated, tests: _tests, git, ...rest } = summary;
  const compactGit = git ? { branch: git.branch, diffStat: git.diffStat, untracked: git.untracked, lastCommit: git.lastCommit } : null;
  return { json: { ...rest, git: compactGit }, text: keyValueLines(summaryLines(summary)) };
}

function renderResult(summary: SessionSummary): string {
  const out: string[] = [];
  const project = summary.project?.name ?? '-';
  out.push(`${summary.status}  ${project}  duration=${formatDuration(summary.durationMs)}  lastSeq=${summary.lastSeq ?? 0}`);
  if (summary.pendingApproval) {
    out.push(`approval: ${summary.pendingApproval.description ?? summary.pendingApproval.toolName ?? summary.pendingApproval.requestId}`);
  }
  if (summary.error) out.push(`error: ${truncate(summary.error, 300)}`);

  out.push('--- response');
  out.push(summary.response ? summary.response + (summary.responseTruncated ? '\n…(truncated)' : '') : '(none)');

  out.push('--- changes');
  if (summary.git) {
    out.push(summary.git.diffStat ?? 'no tracked changes');
    for (const file of summary.git.files.slice(0, MAX_LISTED_FILES)) out.push(`  ${file}`);
    if (summary.git.filesTruncated || summary.git.files.length > MAX_LISTED_FILES) out.push('  …');
    out.push(`untracked: ${summary.git.untracked}`);
  } else {
    out.push('(not a git repository)');
  }

  out.push('--- tests');
  if (summary.tests) {
    const { runner, passed, failed, total } = summary.tests;
    out.push(`${runner} passed=${orDash(passed)} failed=${orDash(failed)} total=${orDash(total)}`);
  } else {
    out.push('not detected');
  }

  out.push('--- commit');
  const commit = summary.git?.lastCommit;
  out.push(commit ? `${commit.hash} ${commit.message}` : '(none)');
  out.push(`branch: ${orDash(summary.git?.branch)}`);
  return out.join('\n');
}

export async function runResult(callTool: CallTool, sessionId: string, sinceSeq?: number): Promise<CommandOutput> {
  const args: Record<string, unknown> = { sessionId, ...(sinceSeq !== undefined ? { sinceSeq } : {}) };
  const summary = requireRecord(await callTool('session_summary', args), 'session_summary') as unknown as SessionSummary;
  return { json: summary, text: renderResult(summary) };
}

export type SessionLine = {
  sessionId: string;
  project: string;
  projectId: string;
  state: 'running' | 'waiting_approval' | 'idle';
  lastActivity: string | null;
  title: string;
  provider: string | null;
};

function matchesProject(project: Record<string, unknown>, filter: string | undefined): boolean {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  const haystacks = [project.name, project.displayName, project.path, project.projectId].map((value) => asString(value)?.toLowerCase() ?? '');
  return haystacks.some((value) => value.includes(needle));
}

export async function runSessions(callTool: CallTool, projectFilter?: string): Promise<CommandOutput> {
  const projects = asArray(await callTool('project_list', { compact: true, skipSync: true })).filter(isRecord).filter((project) => matchesProject(project, projectFilter));
  const running = asArray(requireRecord(await callTool('session_list_running', {}), 'session_list_running').sessions).filter(isRecord);
  const stateById = new Map<string, SessionLine['state']>();
  for (const run of running) {
    const id = asString(run.sessionId);
    if (id) stateById.set(id, run.needsAttention === true ? 'waiting_approval' : 'running');
  }

  const lines: SessionLine[] = [];
  for (const project of projects) {
    const projectId = asString(project.projectId) ?? '';
    if (!projectId) continue;
    const page = requireRecord(await callTool('project_sessions', { projectId, limit: 20 }), 'project_sessions');
    const projectName = asString(project.name) ?? asString(project.displayName) ?? projectId;
    for (const session of asArray(page.sessions).filter(isRecord)) {
      const sessionId = asString(session.id) ?? '';
      if (!sessionId) continue;
      lines.push({
        sessionId,
        project: projectName,
        projectId,
        state: stateById.get(sessionId) ?? 'idle',
        lastActivity: asString(session.lastActivity),
        title: truncate(asString(session.summary), SESSION_TITLE_WIDTH),
        provider: asString(session.provider),
      });
    }
  }
  lines.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
  const rows = lines.map((line) => [line.sessionId, line.project, line.state, orDash(line.lastActivity), line.title]);
  return { json: lines, text: rows.length > 0 ? table(rows) : '(no sessions)' };
}

export async function runNotifyTest(callTool: CallTool, endpointId: string): Promise<CommandOutput> {
  const result = requireRecord(await callTool('notification_endpoint_test', { endpointId }), 'notification_endpoint_test');
  const ok = result.ok === true;
  const deliveryId = orDash(asString(result.deliveryId));
  const attempts = orDash(asNumber(result.attempts));
  const status = orDash(asNumber(result.httpStatus) ?? asNumber(result.status));
  const error = asString(result.error);
  return {
    json: result,
    text: `ok=${ok} deliveryId=${deliveryId} attempts=${attempts} status=${status}${error ? ` error=${truncate(error, 200)}` : ''}`,
  };
}
