/**
 * Composition root of the Team View module, mounted by the server entrypoint
 * at `/api/team-view`.
 *
 * Binds `team-view.service.ts`'s ports to the real running-sessions registry,
 * session/task/message repositories and the cached plan-usage service — the
 * only file in this module allowed to import them directly.
 */

import { agentMessagesDb, projectsDb, sessionsDb, tasksDb } from '@/modules/database/index.js';
import { profileUsageService } from '@/modules/profiles/index.js';
import { sessionsService } from '@/modules/providers/index.js';

import { createTeamViewRouter } from './team-view.routes.js';
import { createTeamViewService } from './team-view.service.js';
import type { TeamViewMessage, TeamViewServiceDeps } from './team-view.types.js';

function toMessages(
  rows: ReturnType<typeof agentMessagesDb.listForSession>,
): TeamViewMessage[] {
  return rows.map((row) => ({
    messageId: row.message_id,
    fromSessionId: row.from_session_id,
    toSessionId: row.to_session_id,
    subject: row.subject,
    state: row.state,
  }));
}

const deps: TeamViewServiceDeps = {
  listRunningSessions: () =>
    sessionsService.listRunningSessions().map((run) => ({
      sessionId: run.sessionId,
      provider: run.provider,
      startedAt: run.startedAt,
    })),

  getSession: (sessionId) => {
    const row = sessionsDb.getSessionById(sessionId);
    if (!row) {
      return null;
    }
    return { projectPath: row.project_path, profileId: row.profile_id };
  },

  resolveProjectId: (projectPath) => projectsDb.getProjectPath(projectPath)?.project_id ?? null,

  listInProgressTasks: (projectId) =>
    tasksDb
      .listByProject(projectId)
      .filter((task) => task.stage === 'in_progress')
      .map((task) => ({
        id: task.id,
        title: task.title,
        assigneeProfileId: task.assignee_profile_id,
        updatedAt: task.updated_at,
      })),

  listSessionMessages: (sessionId) => [
    ...toMessages(agentMessagesDb.listForSession(sessionId, { box: 'inbox' })),
    ...toMessages(agentMessagesDb.listForSession(sessionId, { box: 'outbox' })),
  ],

  getUsagePct: async (profileId) => {
    try {
      const snapshot = await profileUsageService.getUsage(profileId);
      if (snapshot.status !== 'ok' || snapshot.windows.length === 0) {
        return null;
      }
      return snapshot.windows[0]!.utilization;
    } catch {
      // Unknown/unauthenticated profile, fetch failure, ... — quota is
      // best-effort on this graph, never worth failing the snapshot over.
      return null;
    }
  },
};

export const teamViewService = createTeamViewService(deps);

export const teamViewRoutes = createTeamViewRouter(teamViewService);
