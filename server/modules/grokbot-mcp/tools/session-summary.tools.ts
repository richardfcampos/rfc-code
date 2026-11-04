/**
 * `session_summary`: the compact view of a session (status, timings, final
 * answer, git diff --stat, detected test run, last commit). In-process, like
 * the chat tools, so `covers` is empty. Same output as `rfc result --json`.
 */
import { buildSessionSummary } from '@/modules/session-summary/index.js';

import type { ToolDefinition } from '../grokbot-mcp.types.js';

import { optInt, S, schema, str, tool } from './tool-helpers.js';

export const sessionSummaryTools: ToolDefinition[] = [
  tool({
    name: 'session_summary',
    description:
      'Compact summary of a session for an external agent: status (running | idle | waiting_approval | error), start/end/duration ' +
      'of the last run, last event seq, pending approval, the final assistant text (max 1500 chars), git branch and diff --stat ' +
      'of the session directory, the last commit and the test run detected in the tool output. Prefer this over session_events ' +
      'to read a result. Pass sinceSeq to limit the answer to events after that sequence number.',
    inputSchema: schema(
      {
        sessionId: S.string('Session id, as returned by project_sessions or session_create.'),
        sinceSeq: S.integer('Only consider events with seq greater than this (default 0: the whole buffered run).'),
      },
      ['sessionId'],
    ),
    covers: [],
    run: async (args) => {
      const sinceSeq = optInt(args, 'sinceSeq');
      return buildSessionSummary({ sessionId: str(args, 'sessionId'), ...(sinceSeq !== undefined && { sinceSeq }) });
    },
  }),
];
