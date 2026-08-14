/**
 * Cross-provider handoff: continuing a conversation on another provider.
 *
 * A session cannot change provider in place. Chat history is not stored by this
 * app: it is read back through the adapter selected from `sessions.provider`,
 * using the provider-native session id. Flipping that column would point the
 * reader at a store that never saw the conversation, orphaning the transcript
 * and blanking the message pane.
 *
 * So a cross-provider switch creates a *new* session on the target provider and
 * seeds it with a text primer rendered from the earlier conversation. The source
 * session is never mutated — it stays intact and browsable under its own
 * account, which also makes the switch trivially reversible.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { getConnection, sessionsDb, type SessionRow } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';
import { profilesService, type ProfileView } from '@/modules/profiles/profiles.service.js';
import { resolveProfileDir } from '@/modules/profiles/profile-env.js';
import { buildHandoffPrimer, type PrimerMessage } from '@/modules/profiles/handoff-primer.js';
import type { HandoffResult } from '@/modules/profiles/handoff.service.js';

/** Reads the prior conversation of one app session, newest turns included. */
export type LoadHandoffHistory = (sessionId: string) => Promise<PrimerMessage[]>;

/**
 * Default history reader.
 *
 * Resolved through a runtime `import()` on purpose: this module lives in
 * `profiles`, while the history reader lives in `providers`, which already
 * depends on `profiles`. A static import would close that loop at load time.
 * Deferring it to the call keeps the two modules decoupled and lets tests inject
 * their own reader without ever loading the providers module.
 */
export async function loadHandoffHistory(sessionId: string): Promise<PrimerMessage[]> {
  const { sessionsService } = await import('@/modules/providers/index.js');
  const history = await sessionsService.fetchHistory(sessionId);
  return history.messages;
}

/**
 * Refuses a target account that has not been signed in.
 *
 * Unlike a same-provider transplant — which repoints an existing session and can
 * be undone by switching back — this path allocates a brand-new session. Letting
 * it through for an account that cannot run a turn would leave a dead session in
 * the sidebar, so the request is rejected before anything is created.
 */
function assertTargetAuthenticated(target: ProfileView): void {
  if (profilesService.getAuthStatus(target.id).authenticated) {
    return;
  }
  throw new AppError(
    `Profile "${target.name}" is not signed in to ${target.provider}. ` +
      'Sign in to that account, then request the handoff again.',
    { code: 'HANDOFF_TARGET_NOT_AUTHENTICATED', statusCode: 400 },
  );
}

/** Names the account the conversation came from, when it still exists. */
function resolveSourceProfileName(session: SessionRow): string | null {
  if (!session.profile_id) {
    return null;
  }
  try {
    return profilesService.getProfile(session.profile_id).name;
  } catch {
    // The account that ran the source session may have been deleted since. The
    // primer is still worth handing over, just without the account attribution.
    return null;
  }
}

/**
 * Renders the primer, or null when there is nothing to hand over.
 *
 * The prior conversation is context, never a precondition: a history that is
 * empty, unreadable, or made entirely of tool traffic still yields a usable
 * session — it simply starts clean, and the caller reports that.
 */
async function renderPrimer(
  session: SessionRow,
  target: ProfileView,
  loadHistory: LoadHandoffHistory,
): Promise<string | null> {
  try {
    const messages = await loadHistory(session.session_id);
    return await buildHandoffPrimer({
      messages,
      sourceProvider: session.provider,
      sourceProfileName: resolveSourceProfileName(session),
      destinationProvider: target.provider,
    });
  } catch (error) {
    console.error('[handoff] could not read the source history, seeding without a primer:', error);
    return null;
  }
}

/** Absolute path the target profile's primer for `sessionId` is written to. */
export function resolvePrimerPath(target: ProfileView, sessionId: string): string {
  return path.join(
    resolveProfileDir(target.provider, target.slug),
    'handoff-seeds',
    `${sessionId}.md`,
  );
}

/**
 * Creates the target-provider session carrying the prior conversation.
 *
 * The primer file is written before any row exists, and the two writes that
 * follow run in a single transaction. A session with no primer is a legitimate
 * outcome (it just starts clean), but a `seed_primer_path` pointing at a file
 * that was never written would break the first turn with no way to recover it —
 * hence file first, pointer last. A failure while writing the file aborts the
 * whole handoff before anything is persisted, leaving nothing half-created.
 */
export async function seedCrossProviderSession(
  session: SessionRow,
  target: ProfileView,
  loadHistory: LoadHandoffHistory = loadHandoffHistory,
): Promise<HandoffResult> {
  assertTargetAuthenticated(target);

  const seededSessionId = randomUUID();
  const primer = await renderPrimer(session, target, loadHistory);

  let primerPath: string | null = null;
  if (primer !== null) {
    primerPath = resolvePrimerPath(target, seededSessionId);
    fs.mkdirSync(path.dirname(primerPath), { recursive: true });
    fs.writeFileSync(primerPath, primer, 'utf8');
  }

  const persist = getConnection().transaction(() => {
    // The worktree pair travels with the session: a conversation pinned to a
    // worktree must keep running in that same tree under the new account.
    sessionsDb.createAppSession(
      seededSessionId,
      target.provider,
      session.project_path ?? '',
      target.id,
      session.worktree_path,
      session.worktree_branch,
    );
    if (primerPath) {
      sessionsDb.updateSessionSeedPrimerPath(seededSessionId, primerPath);
    }
  });
  persist();

  return {
    status: 'seeded',
    sessionId: seededSessionId,
    seededSessionId,
    profileId: target.id,
    primed: primerPath !== null,
  };
}
