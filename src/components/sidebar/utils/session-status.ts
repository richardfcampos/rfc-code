export type SidebarSessionStatus = 'attn' | 'run' | 'idle';

export type SessionStatusSignals = {
  /** The session has an unresolved attention flag or pending permission request. */
  needsAttention: boolean;
  /** The session is actively processing a request. */
  isRunning: boolean;
};

/**
 * Resolves the single status a session displays from its underlying signals.
 * Waiting on the user wins over running, because that session is the one
 * blocking progress; everything else reads as idle. Shared by the sidebar
 * grouping logic and the session row indicator so both agree on the same
 * decision.
 */
export const resolveSessionStatus = ({
  needsAttention,
  isRunning,
}: SessionStatusSignals): SidebarSessionStatus => (needsAttention ? 'attn' : isRunning ? 'run' : 'idle');
