// Public surface of the Team View feature. Everything outside this folder
// imports from here, same convention as `components/task-board`.

export { default as TeamViewTab } from './view/TeamViewTab';
export { useTeamView } from './hooks/useTeamView';
export type { AgentMessageState, TeamViewEdge, TeamViewSession, TeamViewSessionState, TeamViewSnapshot } from './types';
