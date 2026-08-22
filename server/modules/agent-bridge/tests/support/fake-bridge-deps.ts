/**
 * Test doubles for the Agent Bridge ports.
 *
 * Every collaborator defaults to "unexpected call" so a test only has to
 * describe the interaction it is actually about.
 */

import type { TaskRow } from '@/modules/database/index.js';
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

export interface BridgeTestDeps extends AgentBridgeToolDeps {
  broadcasts: Array<[TaskRow, TaskUpdateAction]>;
  updateCalls: Array<[unknown, Record<string, unknown>]>;
  createCalls: Array<Record<string, unknown>>;
}

export function createBridgeDeps(overrides: Partial<AgentBridgeToolDeps> = {}): BridgeTestDeps {
  const broadcasts: Array<[TaskRow, TaskUpdateAction]> = [];
  const updateCalls: Array<[unknown, Record<string, unknown>]> = [];
  const createCalls: Array<Record<string, unknown>> = [];

  const deps: AgentBridgeToolDeps = {
    tasks: {
      createTask: async (body) => {
        createCalls.push(body);
        return { ...TASK, title: String(body.title ?? TASK.title) };
      },
      listTasks: (project) => (project === SCOPE.projectName ? [TASK] : []),
      updateTask: async (id, body) => {
        updateCalls.push([id, body]);
        return { ...TASK, ...(typeof body.stage === 'string' ? { stage: body.stage as TaskRow['stage'] } : {}) };
      },
      ...overrides.tasks,
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

  return { ...deps, broadcasts, updateCalls, createCalls };
}
