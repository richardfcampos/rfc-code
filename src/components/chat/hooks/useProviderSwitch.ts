import { useCallback, useState } from 'react';

import { useSessionHandoff } from '../../profiles/hooks/useSessionHandoff';
import type { HandoffResult } from '../../profiles/hooks/useSessionHandoff';
import type { Profile } from '../../profiles/types';
import type { LLMProvider } from '../../../types/app';
import type { SessionNavigationOptions } from '../types/types';

/**
 * A cross-provider switch the user still has to confirm. Held as state instead
 * of being asked through a modal/`window.confirm` so each surface (header
 * switcher, composer menu) renders the confirmation in its own idiom while the
 * decision of *whether* to ask lives here.
 */
export interface PendingProviderSwitch {
  /** Session the switch was requested for, pinned at request time. */
  sessionId: string;
  fromProvider: LLMProvider;
  toProvider: LLMProvider;
  profileId: string;
  profileName: string;
  /**
   * Always false today: leaving the provider hands the conversation off onto a
   * leg of the same session (context crosses over, possibly summarized or
   * truncated) rather than creating a new one. Named explicitly so the copy in
   * each surface can key off the consequence rather than off the provider
   * comparison.
   */
  createsNewSession: boolean;
}

export type ProviderSwitchOutcome =
  /** No open session: nothing to hand off, the caller just moves its own selection. */
  | { kind: 'local'; provider: LLMProvider; profileId: string }
  /** Cross-provider: the caller must render `pendingConfirmation` and call `confirmSwitch`. */
  | { kind: 'confirmation-required'; pending: PendingProviderSwitch }
  /** Same provider, applied in place — same session id, only the account badge changes. */
  | { kind: 'transplanted'; sessionId: string; profileId: string }
  /** A turn was streaming; the server applies the switch when it ends and broadcasts it. */
  | { kind: 'queued'; sessionId: string; profileId: string }
  /**
   * Filesystem-level degradation of a same-provider transplant: a genuinely new
   * session id was created, so this still means "navigate". Kept alongside the
   * two leg kinds below rather than folded into them because it is unrelated to
   * the cross-provider handoff path they cover.
   */
  | { kind: 'seeded'; sessionId: string; profileId: string; primed: boolean }
  /** Cross-provider handoff opened a new leg on the same session id — nothing to navigate to. */
  | { kind: 'leg-opened'; sessionId: string; profileId: string; primed: boolean }
  /** Cross-provider handoff resumed an existing leg on the same session id — nothing to navigate to. */
  | { kind: 'leg-resumed'; sessionId: string; profileId: string; primed: boolean }
  | { kind: 'error'; message: string };

export interface UseProviderSwitchArgs {
  /** Null while the empty-state composer is open (no session to hand off). */
  sessionId: string | null;
  /** Provider currently serving the session, or the locally selected one. */
  currentProvider: LLMProvider;
  /** Injected so the hook stays testable and independent of router position. */
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  /** Called when a new session appeared and the sidebar has to pick it up. */
  onSessionsRefresh?: () => void;
  /**
   * Called after a leg lands on the session already open in the UI, so the
   * caller can refetch/invalidate its message history in place — no
   * navigation involved since the session id never changes on this path.
   */
  onSessionHistoryChanged?: (sessionId: string) => void;
}

/**
 * `primed` is only meaningful on the seeded path and older servers may omit it.
 * Absence is read as primed: wrongly telling the user their context was dropped
 * is worse than staying quiet when it actually crossed over.
 */
const readPrimed = (result: HandoffResult): boolean => {
  const { primed } = result as HandoffResult & { primed?: unknown };
  return primed !== false;
};

const toErrorMessage = (error: unknown): string => (
  // The backend's 400 for an unauthenticated target carries the actionable
  // message ("sign in to <profile> first"), so it is surfaced verbatim.
  error instanceof Error && error.message.trim()
    ? error.message
    : 'Failed to switch provider'
);

/**
 * Owns the "switch this session to another provider/account" decision so the
 * header switcher and the composer menu share one rule:
 *
 * - no open session -> local selection change, no request;
 * - same provider   -> immediate handoff, no extra friction;
 * - other provider  -> explicit confirmation first, because the current session
 *   is left behind (still browsable) and the conversation continues elsewhere.
 */
export function useProviderSwitch({
  sessionId,
  currentProvider,
  onNavigateToSession,
  onSessionsRefresh,
  onSessionHistoryChanged,
}: UseProviderSwitchArgs) {
  const { switchAccount, isSwitching } = useSessionHandoff();
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingProviderSwitch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<ProviderSwitchOutcome | null>(null);

  const remember = useCallback((outcome: ProviderSwitchOutcome): ProviderSwitchOutcome => {
    setLastOutcome(outcome);
    return outcome;
  }, []);

  const runHandoff = useCallback(async (
    targetSessionId: string,
    profileId: string,
  ): Promise<ProviderSwitchOutcome> => {
    setError(null);
    try {
      const result = await switchAccount(targetSessionId, profileId);

      if (result.status === 'seeded') {
        // The conversation moved to a session that did not exist a moment ago:
        // refresh the list first so navigation lands on a row the sidebar knows.
        const seededSessionId = result.seededSessionId ?? result.sessionId;
        onSessionsRefresh?.();
        onNavigateToSession?.(seededSessionId);
        return remember({
          kind: 'seeded',
          sessionId: seededSessionId,
          profileId: result.profileId,
          primed: readPrimed(result),
        });
      }

      if (result.status === 'leg-opened' || result.status === 'leg-resumed') {
        // The session id never changes on this path: the user is already
        // looking at the right session, so only its history needs refetching.
        onSessionHistoryChanged?.(result.sessionId);
        return remember({
          kind: result.status,
          sessionId: result.sessionId,
          profileId: result.profileId,
          primed: readPrimed(result),
        });
      }

      if (result.status === 'queued') {
        // Deferred until the running turn ends; the server broadcasts
        // `session.handoff` then, so nothing is navigated or refreshed here.
        return remember({ kind: 'queued', sessionId: result.sessionId, profileId: result.profileId });
      }

      return remember({ kind: 'transplanted', sessionId: result.sessionId, profileId: result.profileId });
    } catch (switchError) {
      const message = toErrorMessage(switchError);
      setError(message);
      return remember({ kind: 'error', message });
    }
  }, [onNavigateToSession, onSessionHistoryChanged, onSessionsRefresh, remember, switchAccount]);

  const requestSwitch = useCallback(async (profile: Profile): Promise<ProviderSwitchOutcome> => {
    setError(null);

    if (!sessionId) {
      // Nothing to hand off yet — the next turn will open the session on the
      // provider the caller selects.
      setPendingConfirmation(null);
      return remember({ kind: 'local', provider: profile.provider, profileId: profile.id });
    }

    if (profile.provider !== currentProvider) {
      const pending: PendingProviderSwitch = {
        sessionId,
        fromProvider: currentProvider,
        toProvider: profile.provider,
        profileId: profile.id,
        profileName: profile.name,
        createsNewSession: false,
      };
      setPendingConfirmation(pending);
      return remember({ kind: 'confirmation-required', pending });
    }

    setPendingConfirmation(null);
    return runHandoff(sessionId, profile.id);
  }, [currentProvider, remember, runHandoff, sessionId]);

  const confirmSwitch = useCallback(async (): Promise<ProviderSwitchOutcome> => {
    const pending = pendingConfirmation;
    if (!pending) {
      return { kind: 'error', message: 'No provider switch is pending' };
    }

    // Resolved against the session captured when the switch was requested: the
    // user may have navigated elsewhere while the confirmation was on screen.
    setPendingConfirmation(null);
    return runHandoff(pending.sessionId, pending.profileId);
  }, [pendingConfirmation, runHandoff]);

  const cancelSwitch = useCallback(() => {
    setPendingConfirmation(null);
  }, []);

  const reset = useCallback(() => {
    setPendingConfirmation(null);
    setError(null);
    setLastOutcome(null);
  }, []);

  return {
    requestSwitch,
    confirmSwitch,
    cancelSwitch,
    reset,
    pendingConfirmation,
    isSwitching,
    error,
    lastOutcome,
  };
}
