/**
 * Read-only contracts for the Team View aggregation: `server/modules/team-view`.
 *
 * Nothing here is persisted — this module composes a snapshot from three
 * existing sources (running sessions, tasks, the handoff inbox) each poll
 * cycle. See `team-view.service.ts` for how the composition happens and why
 * a session's "current task" is a best-effort match rather than a foreign key.
 */

import type { AgentMessageState } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * `running` is the only value the current data source (the chat run
 * registry) can produce — every entry it returns is, by definition, a live
 * run. `idle` is reserved for a future signal (e.g. a connected-but-not
 * streaming session) so the client contract does not need to change again
 * when that lands.
 */
export type TeamViewSessionState = 'running' | 'idle';

export interface TeamViewSession {
  sessionId: string;
  provider: LLMProvider;
  profileId: string | null;
  state: TeamViewSessionState;
  taskId: string | null;
  taskTitle: string | null;
  /** Epoch ms the run started, straight from the chat run registry. */
  startedAt: number;
  /**
   * Best-effort plan-usage percentage for `profileId`'s primary window, from
   * the existing cached usage service. `null` when the profile has none, the
   * snapshot is not `ok`, or the session has no bound profile.
   */
  usagePct: number | null;
}

export interface TeamViewEdge {
  fromSessionId: string;
  toSessionId: string;
  messageId: string;
  state: AgentMessageState;
  subject: string;
}

export interface TeamViewSnapshot {
  sessions: TeamViewSession[];
  edges: TeamViewEdge[];
}

/** One running chat run, as reported by the provider sessions registry. */
export interface TeamViewRunningSession {
  sessionId: string;
  provider: LLMProvider;
  startedAt: number;
}

/** The slice of a session row this module needs to enrich a running run. */
export interface TeamViewSessionLookup {
  projectPath: string | null;
  profileId: string | null;
}

/** The slice of a task row this module needs to guess a session's current task. */
export interface TeamViewTaskCandidate {
  id: string;
  title: string;
  assigneeProfileId: string | null;
  updatedAt: string;
}

/** One handoff message, direction-agnostic — the service filters by endpoint. */
export interface TeamViewMessage {
  messageId: string;
  fromSessionId: string;
  toSessionId: string;
  subject: string;
  state: AgentMessageState;
}

/**
 * Ports this module composes over. Each is a thin read from an existing
 * repository/service — the module owns no storage of its own — injected here
 * so the aggregation logic is testable against fakes instead of a live DB.
 */
export interface TeamViewServiceDeps {
  listRunningSessions(): TeamViewRunningSession[];
  getSession(sessionId: string): TeamViewSessionLookup | null;
  /** Maps a session's `project_path` to the project id tasks are filed under, or null when unknown. */
  resolveProjectId(projectPath: string): string | null;
  /** Tasks currently `in_progress` for a project, any assignee. */
  listInProgressTasks(projectId: string): TeamViewTaskCandidate[];
  /** Every message in `sessionId`'s inbox and outbox, oldest first. */
  listSessionMessages(sessionId: string): TeamViewMessage[];
  /** Cached plan-usage percentage for a profile; `null` on any failure or unknown state. */
  getUsagePct(profileId: string): Promise<number | null>;
}

export interface TeamViewService {
  getSnapshot(): Promise<TeamViewSnapshot>;
}
