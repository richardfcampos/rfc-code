/**
 * Process-wide feed of session state transitions, raised by the chat run
 * registry the moment a run ends (`idle` / `error`) or blocks on a tool
 * approval (`waiting_approval`). Subscribers (the session webhook dispatcher,
 * wired by the entrypoint) react without the registry knowing they exist, and
 * a subscriber that throws never reaches the event path that raised it.
 */

import { EventEmitter } from 'node:events';

export type SessionLifecycleStatus = 'idle' | 'error' | 'waiting_approval';

export type SessionLifecycleTransition = {
  sessionId: string;
  provider: string;
  status: SessionLifecycleStatus;
  startedAt: string | null;
  finishedAt: string | null;
  lastSeq: number;
  exitCode: number | null;
  aborted: boolean;
  /** Set for `waiting_approval`: the approval request the run is blocked on. */
  requestId: string | null;
  /** Set for `error`: the last error text the runtime reported. */
  error: string | null;
};

type TransitionListener = (transition: SessionLifecycleTransition) => void;

class SessionLifecycleEmitter extends EventEmitter {
  onTransition(listener: TransitionListener): () => void {
    this.on('transition', listener);
    return () => {
      this.off('transition', listener);
    };
  }

  /** Never throws: a listener failure is logged, not propagated to the run. */
  emitTransition(transition: SessionLifecycleTransition): void {
    try {
      this.emit('transition', transition);
    } catch (error) {
      console.error('[session-lifecycle] a transition listener failed:', error);
    }
  }
}

export const sessionLifecycleEvents = new SessionLifecycleEmitter();
