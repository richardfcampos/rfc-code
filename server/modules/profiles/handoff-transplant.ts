/**
 * Same-provider handoff mechanics: session-file transplant and its fallback.
 *
 * Both accounts speak the same transcript format here, so the conversation can
 * move as a file:
 *
 *  1. Primary — transplant + native resume. The provider's own transcript
 *     artifact is copied from the current profile's config dir into the target
 *     profile's config dir at the same relative store path, a switch marker is
 *     appended, and `sessions.profile_id` is repointed. The next turn resumes
 *     natively under the target account (dispatch reads `profile_id`). Proven
 *     portable for Claude and Codex (see design.md session portability spike).
 *
 *  2. Degradation — for providers whose session file is not portable (or when
 *     the artifact is missing/unreadable), a brand-new session is seeded with
 *     the prior transcript as context and bound to the target profile. This is
 *     explicit and observable (status 'seeded'); it is never a silent failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { sessionsDb, type SessionRow } from '@/modules/database/index.js';
import type { ProfileView } from '@/modules/profiles/profiles.service.js';
import { resolveProfileDir } from '@/modules/profiles/profile-env.js';
import type { HandoffResult } from '@/modules/profiles/handoff.service.js';

// Providers whose native session artifact is portable across config dirs, keyed
// by the store-root directory segment their CLI writes it under (proven by the
// portability spike). Absence here means "degrade to a seeded session".
const PROVIDER_STORE_SEGMENT: Record<string, string> = {
  claude: 'projects',
  codex: 'sessions',
};

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

/** Applies a switch between two profiles of the same provider. */
export function applySameProviderSwitch(session: SessionRow, target: ProfileView): HandoffResult {
  const storeSegment = PROVIDER_STORE_SEGMENT[session.provider];
  const canTransplant =
    Boolean(storeSegment) &&
    Boolean(session.jsonl_path) &&
    fs.existsSync(session.jsonl_path as string);

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
