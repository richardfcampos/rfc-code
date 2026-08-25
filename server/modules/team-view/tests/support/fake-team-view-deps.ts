/**
 * In-memory doubles for the Team View ports.
 *
 * The service under test never touches a database or the real chat run
 * registry — every case here is reachable through plain arrays/maps.
 */

import type {
  TeamViewMessage,
  TeamViewRunningSession,
  TeamViewServiceDeps,
  TeamViewSessionLookup,
  TeamViewTaskCandidate,
} from '@/modules/team-view/team-view.types.js';

export interface FakeSetup {
  running?: TeamViewRunningSession[];
  sessions?: Record<string, TeamViewSessionLookup>;
  /** projectPath -> projectId */
  projects?: Record<string, string>;
  /** projectId -> in-progress task candidates */
  tasksByProject?: Record<string, TeamViewTaskCandidate[]>;
  /** sessionId -> every message touching that session's inbox/outbox */
  messagesBySession?: Record<string, TeamViewMessage[]>;
  /** profileId -> usage pct, or an Error to simulate a failed fetch */
  usage?: Record<string, number | Error>;
}

export interface FakeDeps {
  deps: TeamViewServiceDeps;
  usageCalls: string[];
}

export function createFakeDeps(setup: FakeSetup = {}): FakeDeps {
  const running = setup.running ?? [];
  const sessions = setup.sessions ?? {};
  const projects = setup.projects ?? {};
  const tasksByProject = setup.tasksByProject ?? {};
  const messagesBySession = setup.messagesBySession ?? {};
  const usage = setup.usage ?? {};
  const usageCalls: string[] = [];

  const deps: TeamViewServiceDeps = {
    listRunningSessions: () => [...running],
    getSession: (sessionId) => sessions[sessionId] ?? null,
    resolveProjectId: (projectPath) => projects[projectPath] ?? null,
    listInProgressTasks: (projectId) => tasksByProject[projectId] ?? [],
    listSessionMessages: (sessionId) => messagesBySession[sessionId] ?? [],
    getUsagePct: async (profileId) => {
      usageCalls.push(profileId);
      const entry = usage[profileId];
      if (entry instanceof Error) {
        throw entry;
      }
      return entry ?? null;
    },
  };

  return { deps, usageCalls };
}

export function makeMessage(
  messageId: string,
  fromSessionId: string,
  toSessionId: string,
  overrides: Partial<Pick<TeamViewMessage, 'state' | 'subject'>> = {},
): TeamViewMessage {
  return {
    messageId,
    fromSessionId,
    toSessionId,
    subject: overrides.subject ?? 'handoff',
    state: overrides.state ?? 'queued',
  };
}
