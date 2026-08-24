/**
 * Application service for the Team View aggregation: `server/modules/team-view`.
 *
 * Read-only by construction (C2 — Team View is a canvas over orchestration
 * data, never a workspace): this file has no write path, and none of the
 * ports it depends on can mutate anything either.
 *
 * Nodes = currently running sessions (the chat run registry's live-run list).
 * Edges = handoff messages between two sessions that are BOTH in that list —
 * a message to/from a session that has since finished would render a dangling
 * line to a node the graph does not have, so it is left out rather than
 * inventing a placeholder node for it.
 *
 * A session's "current task" is a best-effort guess, not a foreign key: tasks
 * have no `session_id` column (they are assigned to a *profile*, not a run),
 * so this picks the most recently updated `in_progress` task in the session's
 * project that is assigned to the session's profile. Ambiguous (two tasks,
 * same profile) resolves to the most recently touched one; wrong-but-rare
 * beats adding a schema column for a read-only view.
 */

import type {
  TeamViewEdge,
  TeamViewServiceDeps,
  TeamViewSession,
  TeamViewSnapshot,
  TeamViewTaskCandidate,
} from './team-view.types.js';

/** Picks the most recently updated task assigned to `profileId`, or null. */
function pickCurrentTask(
  candidates: TeamViewTaskCandidate[],
  profileId: string | null,
): TeamViewTaskCandidate | null {
  if (!profileId) {
    return null;
  }

  let current: TeamViewTaskCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.assigneeProfileId !== profileId) {
      continue;
    }
    if (!current || candidate.updatedAt > current.updatedAt) {
      current = candidate;
    }
  }
  return current;
}

async function buildSession(
  deps: TeamViewServiceDeps,
  running: { sessionId: string; provider: TeamViewSession['provider']; startedAt: number },
  usagePctCache: Map<string, Promise<number | null>>,
): Promise<TeamViewSession> {
  const lookup = deps.getSession(running.sessionId);
  const profileId = lookup?.profileId ?? null;

  let taskId: string | null = null;
  let taskTitle: string | null = null;
  if (lookup?.projectPath && profileId) {
    const projectId = deps.resolveProjectId(lookup.projectPath);
    if (projectId) {
      const task = pickCurrentTask(deps.listInProgressTasks(projectId), profileId);
      if (task) {
        taskId = task.id;
        taskTitle = task.title;
      }
    }
  }

  let usagePct: number | null = null;
  if (profileId) {
    let pending = usagePctCache.get(profileId);
    if (!pending) {
      // A profile fetch failing must not take down the whole snapshot —
      // quota is a nice-to-have on this graph, not something the rest of the
      // node's data should depend on.
      pending = deps.getUsagePct(profileId).catch(() => null);
      usagePctCache.set(profileId, pending);
    }
    usagePct = await pending;
  }

  return {
    sessionId: running.sessionId,
    provider: running.provider,
    profileId,
    // The only source wired in today (the chat run registry's live-run list)
    // reports exclusively running sessions — see the `idle` note on the type.
    state: 'running',
    taskId,
    taskTitle,
    startedAt: running.startedAt,
    usagePct,
  };
}

/** Deterministic ordering so repeated snapshots with unchanged data compare equal. */
function sortEdges(edges: TeamViewEdge[]): TeamViewEdge[] {
  return [...edges].sort((left, right) => left.messageId.localeCompare(right.messageId));
}

function collectEdges(deps: TeamViewServiceDeps, runningIds: Set<string>): TeamViewEdge[] {
  const byMessageId = new Map<string, TeamViewEdge>();

  for (const sessionId of runningIds) {
    for (const message of deps.listSessionMessages(sessionId)) {
      if (byMessageId.has(message.messageId)) {
        continue;
      }
      if (!runningIds.has(message.fromSessionId) || !runningIds.has(message.toSessionId)) {
        continue;
      }
      byMessageId.set(message.messageId, {
        fromSessionId: message.fromSessionId,
        toSessionId: message.toSessionId,
        messageId: message.messageId,
        state: message.state,
        subject: message.subject,
      });
    }
  }

  return sortEdges(Array.from(byMessageId.values()));
}

async function getSnapshot(deps: TeamViewServiceDeps): Promise<TeamViewSnapshot> {
  const running = deps.listRunningSessions();
  const runningIds = new Set(running.map((entry) => entry.sessionId));
  const usagePctCache = new Map<string, Promise<number | null>>();

  const sessions = await Promise.all(
    running.map((entry) => buildSession(deps, entry, usagePctCache)),
  );

  return {
    sessions,
    edges: collectEdges(deps, runningIds),
  };
}

/**
 * Composition root for the Team View application service.
 *
 * Every port is injected so the aggregation logic — the only "business
 * logic" this module has — is testable against fakes, never a live DB or
 * a real chat run registry.
 */
export function createTeamViewService(deps: TeamViewServiceDeps): {
  getSnapshot(): Promise<TeamViewSnapshot>;
} {
  return {
    getSnapshot: () => getSnapshot(deps),
  };
}
