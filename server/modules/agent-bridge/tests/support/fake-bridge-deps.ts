/**
 * Test doubles for the Agent Bridge ports.
 *
 * Every collaborator defaults to "unexpected call" so a test only has to
 * describe the interaction it is actually about.
 */

import type { AgentMessageRow, TaskEvidenceRow, TaskRow } from '@/modules/database/index.js';
import type { TaskUpdateAction } from '@/modules/tasks/index.js';

import type {
  AgentBridgeSessionScope,
  AgentBridgeToolDeps,
} from '../../agent-bridge.types.js';

export const SCOPE: AgentBridgeSessionScope = {
  sessionId: 'session-1',
  projectPath: '/home/dev/my-app',
  projectName: 'project-1',
};

export const TASK: TaskRow = {
  id: 'task-1',
  project_name: SCOPE.projectName,
  title: 'Ship it',
  description: null,
  stage: 'backlog',
  origin: 'agent',
  origin_detail: SCOPE.sessionId,
  assignee_profile_id: null,
  suggested_skill: null,
  worktree_branch: null,
  created_at: '2026-08-20T00:00:00.000Z',
  updated_at: '2026-08-20T00:00:00.000Z',
};

export const EVIDENCE: TaskEvidenceRow = {
  evidence_id: 'evidence-1',
  task_id: TASK.id,
  kind: 'note',
  content: 'Repro confirmed',
  attachment_id: null,
  created_at: '2026-08-20T00:00:00.000Z',
};

export const MESSAGE: AgentMessageRow = {
  message_id: 'message-1',
  from_session_id: 'session-2',
  to_session_id: SCOPE.sessionId,
  subject: 'Review the parser fix',
  body: 'Branch feat/parser is ready.',
  state: 'queued',
  reply_to_message_id: null,
  detail: null,
  created_at: '2026-08-20T00:00:00.000Z',
  updated_at: '2026-08-20T00:00:00.000Z',
};

/** One recorded call to the messages port: the acting session plus its arguments. */
export type MessageCall = [string, ...unknown[]];

export interface BridgeTestDeps extends AgentBridgeToolDeps {
  broadcasts: Array<[TaskRow, TaskUpdateAction]>;
  updateCalls: Array<[unknown, Record<string, unknown>]>;
  createCalls: Array<Record<string, unknown>>;
  evidenceCalls: Array<[unknown, Record<string, unknown>]>;
  messageCalls: Record<'send' | 'list' | 'pullInbox' | 'acknowledge' | 'answer', MessageCall[]>;
}

export function createBridgeDeps(overrides: Partial<AgentBridgeToolDeps> = {}): BridgeTestDeps {
  const broadcasts: Array<[TaskRow, TaskUpdateAction]> = [];
  const updateCalls: Array<[unknown, Record<string, unknown>]> = [];
  const createCalls: Array<Record<string, unknown>> = [];
  const evidenceCalls: Array<[unknown, Record<string, unknown>]> = [];
  const messageCalls: BridgeTestDeps['messageCalls'] = {
    send: [],
    list: [],
    pullInbox: [],
    acknowledge: [],
    answer: [],
  };

  const deps: AgentBridgeToolDeps = {
    tasks: {
      createTask: async (body) => {
        createCalls.push(body);
        return { ...TASK, title: String(body.title ?? TASK.title) };
      },
      listTasks: (project) => (project === SCOPE.projectName ? [TASK] : []),
      updateTask: async (id, body) => {
        updateCalls.push([id, body]);
        return {
          ...TASK,
          ...(typeof body.stage === 'string' ? { stage: body.stage as TaskRow['stage'] } : {}),
          ...(typeof body.description === 'string' ? { description: body.description } : {}),
        };
      },
      addEvidence: (taskId, body) => {
        evidenceCalls.push([taskId, body]);
        return { ...EVIDENCE, kind: (body.kind as TaskEvidenceRow['kind']) ?? EVIDENCE.kind, content: String(body.content ?? EVIDENCE.content) };
      },
      ...overrides.tasks,
    },
    // Mirrors the real service closely enough for the dispatch tests: it
    // records who acted and echoes a row in the state that call produces.
    messages: overrides.messages ?? {
      send: (fromSessionId, body) => {
        messageCalls.send.push([fromSessionId, body]);
        return {
          ...MESSAGE,
          from_session_id: fromSessionId,
          to_session_id: String(body.toSessionId ?? MESSAGE.to_session_id),
          subject: String(body.subject ?? MESSAGE.subject),
          body: String(body.body ?? MESSAGE.body),
          reply_to_message_id:
            typeof body.replyToMessageId === 'string' ? body.replyToMessageId : null,
        };
      },
      list: (sessionId, filter) => {
        messageCalls.list.push([sessionId, filter]);
        return [{ ...MESSAGE, from_session_id: sessionId, to_session_id: 'session-2' }];
      },
      pullInbox: (sessionId, filter) => {
        messageCalls.pullInbox.push([sessionId, filter]);
        return [{ ...MESSAGE, to_session_id: sessionId, state: 'delivered' }];
      },
      acknowledge: (sessionId, messageId) => {
        messageCalls.acknowledge.push([sessionId, messageId]);
        return { ...MESSAGE, to_session_id: sessionId, state: 'acknowledged' };
      },
      answer: (sessionId, messageId, body) => {
        messageCalls.answer.push([sessionId, messageId, body]);
        return {
          message: { ...MESSAGE, to_session_id: sessionId, state: 'answered' },
          reply: {
            ...MESSAGE,
            message_id: 'message-2',
            from_session_id: sessionId,
            to_session_id: MESSAGE.from_session_id,
            subject: `Re: ${MESSAGE.subject}`,
            body: String(body.body ?? ''),
            reply_to_message_id: MESSAGE.message_id,
          },
        };
      },
    },
    policy: overrides.policy ?? {
      assertProfileAllowed: () => {},
    },
    recommend: overrides.recommend ?? {
      recommend: async () => ({
        profileId: 'profile-1',
        role: 'primary',
        usagePct: 12,
        reason: 'primary account below threshold',
      }),
    },
    broadcast: overrides.broadcast ?? ((task, action) => {
      broadcasts.push([task, action]);
    }),
  };

  return { ...deps, broadcasts, updateCalls, createCalls, evidenceCalls, messageCalls };
}
