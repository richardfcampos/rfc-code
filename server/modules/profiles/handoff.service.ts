/**
 * Mid-session account handoff (HUB-12).
 *
 * Switches the account profile that serves an existing session *between turns*,
 * preserving the conversation. Two mechanics:
 *
 *  1. Primary — session-file transplant + native resume. The provider's own
 *     transcript artifact is copied from the current profile's config dir into
 *     the target profile's config dir at the same relative store path, a switch
 *     marker is appended, and `sessions.profile_id` is repointed. The next turn
 *     resumes natively under the target account (dispatch reads `profile_id`).
 *     Proven portable for Claude and Codex (see design.md session portability
 *     spike): the only gate is that the destination profile is authenticated.
 *
 *  2. Degradation — for providers whose session file is not portable (or when
 *     the artifact is missing/unreadable), a brand-new session is seeded with
 *     the prior transcript as context and bound to the target profile. This is
 *     explicit and observable (status 'seeded'); it is never a silent failure.
 *
 * Edge case: a switch requested while a turn is executing is queued and applied
 * once the turn ends — the running turn is never killed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { sessionsDb, type SessionRow } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';
import { profilesService, type ProfileView } from '@/modules/profiles/profiles.service.js';
import { resolveProfileDir } from '@/modules/profiles/profile-env.js';

export type HandoffStatus = 'queued' | 'transplanted' | 'seeded';

export interface HandoffResult {
  status: HandoffStatus;
  /** Session that continues the conversation (a new id only when seeded). */
  sessionId: string;
  /** Target profile now owning the session. */
  profileId: string;
  /** Present only when the handoff degraded to a fresh seeded session. */
  seededSessionId?: string;
}

export interface HandoffDeps {
  /** Whether a turn is currently executing for this session. */
  isSessionRunning?: (session: SessionRow) => boolean;
}

// Providers whose native session artifact is portable across config dirs, keyed
// by the store-root directory segment their CLI writes it under (proven by the
// portability spike). Absence here means "degrade to a seeded session".
const PROVIDER_STORE_SEGMENT: Record<string, string> = {
  claude: 'projects',
  codex: 'sessions',
};

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

/**
 * Copies a provider transcript from its current config dir into `targetDir`,
 * preserving the relative path below the provider's store segment so the target
 * CLI discovers it exactly where it expects (that path layout is what makes the
 * session resumable under the new profile).
 */
function transplantArtifact(sourcePath: string, storeSegment: string, targetDir: string): string {
  const boundary = `${path.sep}${storeSegment}${path.sep}`;
  const index = sourcePath.indexOf(boundary);
  if (index === -1) {
    throw new Error(`Transcript "${sourcePath}" is not under a "${storeSegment}" store.`);
  }
  const relative = sourcePath.slice(index + boundary.length);
  const targetPath = path.join(targetDir, storeSegment, relative);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function buildSwitchMarker(session: SessionRow, target: ProfileView): string {
  const marker = {
    type: 'profile-switch',
    sessionId: session.provider_session_id ?? session.session_id,
    fromProfileId: session.profile_id ?? null,
    toProfileId: target.id,
    toProfileName: target.name,
    timestamp: new Date().toISOString(),
    note: `Account switched to "${target.name}"`,
  };
  return `${JSON.stringify(marker)}\n`;
}

/** Primary path: transplant + marker + repoint profile_id. */
function transplantHandoff(
  session: SessionRow,
  target: ProfileView,
  storeSegment: string,
): HandoffResult {
  const targetDir = resolveProfileDir(target.provider, target.slug);
  const transplantedPath = transplantArtifact(session.jsonl_path as string, storeSegment, targetDir);
  fs.appendFileSync(transplantedPath, buildSwitchMarker(session, target));
  sessionsDb.updateSessionProfileId(session.session_id, target.id);
  return { status: 'transplanted', sessionId: session.session_id, profileId: target.id };
}

/** Degradation path: seed a new session with the prior context (AC2). */
function seedHandoff(session: SessionRow, target: ProfileView): HandoffResult {
  const newSessionId = randomUUID();
  const projectPath = session.project_path ?? '';
  sessionsDb.createAppSession(newSessionId, session.provider, projectPath, target.id);

  const targetDir = resolveProfileDir(target.provider, target.slug);
  const seedPath = path.join(targetDir, 'handoff-seeds', `${newSessionId}.jsonl`);
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });

  const priorTranscript =
    session.jsonl_path && fs.existsSync(session.jsonl_path)
      ? fs.readFileSync(session.jsonl_path, 'utf8')
      : '';
  fs.writeFileSync(seedPath, `${buildSwitchMarker(session, target)}${priorTranscript}`);
  sessionsDb.updateSessionJsonlPath(newSessionId, seedPath);

  return {
    status: 'seeded',
    sessionId: newSessionId,
    seededSessionId: newSessionId,
    profileId: target.id,
  };
}

function applySwitch(session: SessionRow, target: ProfileView): HandoffResult {
  const storeSegment = PROVIDER_STORE_SEGMENT[session.provider];
  const canTransplant =
    Boolean(storeSegment) && Boolean(session.jsonl_path) && fs.existsSync(session.jsonl_path as string);

  if (canTransplant) {
    try {
      return transplantHandoff(session, target, storeSegment);
    } catch (error) {
      // Primary mechanic failed at the filesystem level — degrade explicitly
      // rather than leaving the session in a half-switched state.
      console.error('[handoff] transplant failed, degrading to a seeded session:', error);
    }
  }

  return seedHandoff(session, target);
}

/**
 * Switches the profile serving `sessionId` to `targetProfileId`.
 *
 * Validates eagerly (unknown session/profile, provider mismatch, no-op) so a bad
 * request is rejected up front even when the switch has to be queued.
 */
export function switchSessionProfile(
  sessionId: string,
  targetProfileId: string,
  deps: HandoffDeps = {},
): HandoffResult {
  const session = loadSessionOrThrow(sessionId);
  const target = profilesService.getProfile(targetProfileId);

  if (target.provider !== session.provider) {
    throw new AppError(
      `Cannot hand a ${session.provider} session to a ${target.provider} profile.`,
      { code: 'HANDOFF_PROVIDER_MISMATCH', statusCode: 400 },
    );
  }
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

  return applySwitch(session, target);
}

/**
 * Applies a queued switch once the running turn ends. Runs in the run-loop's
 * completion path, so it must never throw — a failed drain is logged and
 * dropped, and the operator can retry the switch.
 */
export function drainPendingSwitch(sessionId: string): HandoffResult | null {
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
    return applySwitch(session, target);
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
