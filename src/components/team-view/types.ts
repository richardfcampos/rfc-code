// Frontend mirror of `GET /api/team-view` (server/modules/team-view/team-view.types.ts)
// and the AgentMessageState enum it reuses — same "frontend keeps its own copy of server
// contracts" convention as `components/task-board/types.ts`.

import type { LLMProvider } from '../../types/app';

export type TeamViewSessionState = 'running' | 'idle';

export type AgentMessageState = 'queued' | 'delivered' | 'acknowledged' | 'answered' | 'failed';

export interface TeamViewSession {
  sessionId: string;
  provider: LLMProvider;
  profileId: string | null;
  state: TeamViewSessionState;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: number;
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
