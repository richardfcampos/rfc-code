/**
 * Mid-session account handoff (HUB-12).
 *
 * Switches the account profile that serves an existing session *between turns*,
 * preserving the conversation. Which mechanic applies depends on whether the
 * target account speaks the same provider:
 *
 *  - Same provider — the session itself is handed over: its native transcript is
 *    transplanted into the target profile's config dir and `profile_id` is
 *    repointed, so the next turn resumes natively (see handoff-transplant.ts).
 *
 *  - Different provider — the transcript cannot move, because it only exists in
 *    the source provider's store. The session keeps its id and opens (or resumes)
 *    a leg on the target provider, primed with the earlier conversation as text,
 *    so one conversation stays one entry across providers (see handoff-leg.ts).
 *
 * Edge case: a switch requested while a turn is executing is queued and applied
 * once the turn ends — the running turn is never killed.
 */

import { sessionsDb, type SessionRow } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';
import { profilesService, type ProfileView } from '@/modules/profiles/profiles.service.js';
import { applySameProviderSwitch } from '@/modules/profiles/handoff-transplant.js';
import { applyCrossProviderSwitch } from '@/modules/profiles/handoff-leg.js';
import type { LoadHandoffHistory } from '@/modules/profiles/handoff-seed.js';

/**
 * `seeded` is not a leftover of the cross-provider path it used to name: the
 * same-provider transplant still degrades to a fresh seeded session when it
 * cannot copy the native transcript, and that is the only producer left.
 */
export type HandoffStatus =
  | 'queued'
  | 'transplanted'
  | 'seeded'
  | 'leg-opened'
  | 'leg-resumed';

export interface HandoffResult {
  status: HandoffStatus;
  /** Session that continues the conversation (a new id only when seeded). */
  sessionId: string;
  /** Target profile now owning the session. */
  profileId: string;
  /** Present only when a same-provider handoff degraded to a seeded session. */
  seededSessionId?: string;
  /**
   * Whether the target leg carries the earlier conversation as context.
   *
   * Set only on the cross-provider path, where the prior history is best-effort:
   * `false` means the leg is live but starts clean (history empty, unreadable,
   * or made entirely of tool traffic). Callers must surface that instead of
   * assuming context always crossed over.
   */
  primed?: boolean;
}

export interface HandoffDeps {
  /** Whether a turn is currently executing for this session. */
  isSessionRunning?: (session: SessionRow) => boolean;
  /** Source of the prior conversation for a cross-provider primer. */
  loadHistory?: LoadHandoffHistory;
}

// Session ids the run loop has marked as actively executing a turn, and switches
// deferred until the running turn ends. Both key off whatever id the run loop
// reports (app id or provider id), reconciled in the default running check.
const runningSessions = new Set<string>();
const pendingSwitches = new Map<string, string>();

/** Marks a session as running a turn (called by the run loop on turn start). */
export function markSessionRunning(sessionId: string): void {
  if (sessionId) {
    runningSessions.add(sessionId);
  }
}

/** Clears a session's running flag (called by the run loop on turn end). */
export function markSessionIdle(sessionId: string): void {
  if (sessionId) {
    runningSessions.delete(sessionId);
  }
}

function defaultIsSessionRunning(session: SessionRow): boolean {
  return (
    runningSessions.has(session.session_id) ||
    (session.provider_session_id != null && runningSessions.has(session.provider_session_id))
  );
}

function loadSessionOrThrow(sessionId: string): SessionRow {
  const session =
    sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
  if (!session) {
    throw new AppError(`Session "${sessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }
  return session;
}

async function applySwitch(
  session: SessionRow,
  target: ProfileView,
  loadHistory?: LoadHandoffHistory,
): Promise<HandoffResult> {
  if (target.provider !== session.provider) {
    const leg = await applyCrossProviderSwitch(session, target, loadHistory);
    return {
      status: leg.status,
      sessionId: leg.sessionId,
      profileId: leg.profileId,
      primed: leg.primed,
    };
  }
  return applySameProviderSwitch(session, target);
}

/**
 * Switches the profile serving `sessionId` to `targetProfileId`.
 *
 * Validates eagerly (unknown session/profile, no-op) so a bad request is
 * rejected up front even when the switch has to be queued.
 */
export async function switchSessionProfile(
  sessionId: string,
  targetProfileId: string,
  deps: HandoffDeps = {},
): Promise<HandoffResult> {
  const session = loadSessionOrThrow(sessionId);
  const target = profilesService.getProfile(targetProfileId);

  if (session.profile_id === target.id) {
    throw new AppError('Session is already on that profile.', {
      code: 'HANDOFF_NO_OP',
      statusCode: 400,
    });
  }

  const isRunning = deps.isSessionRunning ?? defaultIsSessionRunning;
  if (isRunning(session)) {
    pendingSwitches.set(session.session_id, target.id);
    return { status: 'queued', sessionId: session.session_id, profileId: target.id };
  }

  return applySwitch(session, target, deps.loadHistory);
}

/**
 * Applies a queued switch once the running turn ends. Runs in the run-loop's
 * completion path, so it must never throw — a failed drain is logged and
 * dropped, and the operator can retry the switch.
 */
export async function drainPendingSwitch(
  sessionId: string,
  deps: HandoffDeps = {},
): Promise<HandoffResult | null> {
  try {
    const session =
      sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
    const key = session?.session_id ?? sessionId;
    const targetProfileId = pendingSwitches.get(key);
    pendingSwitches.delete(key);

    if (!session || !targetProfileId) {
      return null;
    }

    const target = profilesService.getProfile(targetProfileId);
    return await applySwitch(session, target, deps.loadHistory);
  } catch (error) {
    console.error('[handoff] deferred switch failed to apply:', error);
    return null;
  }
}

export const handoffService = {
  switchSessionProfile,
  drainPendingSwitch,
  markSessionRunning,
  markSessionIdle,
};
