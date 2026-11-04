/** Realistic tool results, shaped like the server's `session_summary` and REST tools return them. */

import type { SessionSummary } from '@/modules/session-summary/index.js';

export const idleSummary: SessionSummary = {
  sessionId: 'sess-abc',
  provider: 'claude',
  project: { id: 'proj-1', name: 'rfc-code', path: '/srv/code/personal/rfc-code' },
  status: 'idle',
  startedAt: '2026-11-04T01:10:03.000Z',
  finishedAt: '2026-11-04T01:13:07.000Z',
  durationMs: 184_000,
  lastSeq: 412,
  pendingApproval: null,
  error: null,
  response: 'Done. I fixed the parser and added two tests.',
  responseTruncated: false,
  git: {
    branch: 'feat/x',
    diffStat: '3 files changed, 41 insertions(+), 2 deletions(-)',
    files: ['server/a.ts', 'server/b.ts', 'README.md'],
    filesTruncated: false,
    untracked: 1,
    lastCommit: { hash: '8f862e0', message: 'fix(taskmaster): seed tasks.json' },
  },
  tests: { runner: 'node:test', passed: 42, failed: 0, total: 42 },
};

export const waitingSummary: SessionSummary = {
  ...idleSummary,
  sessionId: 'sess-wait',
  status: 'waiting_approval',
  finishedAt: null,
  durationMs: 65_000,
  pendingApproval: { requestId: 'req-9', toolName: 'Bash', description: 'Bash: rm -rf dist' },
  response: null,
  tests: null,
  git: null,
};

export const errorSummary: SessionSummary = {
  ...idleSummary,
  sessionId: 'sess-err',
  status: 'error',
  error: 'The run stopped without reporting a reason.',
  response: 'x'.repeat(1500),
  responseTruncated: true,
  tests: { runner: 'vitest', passed: 10, failed: 2, total: 12 },
};

export const compactProjects = [
  { projectId: 'proj-1', name: 'rfc-code', path: '/srv/code/personal/rfc-code', activeSessions: 1, sessionsTotal: 2, lastActivity: '2026-11-04T01:13:07.000Z' },
  { projectId: 'proj-2', name: 'comanda', path: '/srv/code/comanda', activeSessions: 0, sessionsTotal: 1, lastActivity: '2026-11-03T20:00:00.000Z' },
];

export const projectSessionsPages: Record<string, unknown> = {
  'proj-1': {
    projectId: 'proj-1',
    sessions: [
      { id: 'sess-abc', provider: 'claude', summary: 'Fix the parser and add tests for the edge cases', messageCount: 0, lastActivity: '2026-11-04T01:13:07.000Z' },
      { id: 'sess-wait', provider: 'codex', summary: 'Refactor', messageCount: 0, lastActivity: '2026-11-04T00:50:00.000Z' },
    ],
    sessionMeta: { hasMore: false, total: 2 },
  },
  'proj-2': {
    projectId: 'proj-2',
    sessions: [{ id: 'sess-old', provider: 'claude', summary: '', messageCount: 0, lastActivity: '2026-11-03T20:00:00.000Z' }],
    sessionMeta: { hasMore: false, total: 1 },
  },
};

export const runningSessions = {
  sessions: [
    { sessionId: 'sess-abc', provider: 'claude', startedAt: 1, lastSeq: 10, needsAttention: false, statusText: null, canInterrupt: true },
    { sessionId: 'sess-wait', provider: 'codex', startedAt: 1, lastSeq: 3, needsAttention: true, statusText: 'Bash needs approval', canInterrupt: true },
  ],
};

export const notifyTestResult = { ok: true, deliveryId: 'dlv_01', attempts: 1, httpStatus: 200, endpointId: 'james' };
