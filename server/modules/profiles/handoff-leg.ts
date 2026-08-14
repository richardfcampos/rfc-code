/**
 * Cross-provider switch applied as a leg of the *same* session.
 *
 * Seeding a brand-new session (see `handoff-seed.ts`) keeps each provider's
 * transcript readable, but it splits one conversation into a chain of sidebar
 * entries: the id the app hands out changes on every switch, so anything that
 * held onto it — an open tab, a pinned link, the message pane — ends up looking
 * at a session that stopped growing.
 *
 * A leg keeps the app-facing `session_id` fixed and moves only what identifies
 * the *current* provider run. Each (provider, account) pair the conversation has
 * visited owns one leg holding its own native transcript, and the `sessions` row
 * always projects whichever leg is live. Switching back to a provider the
 * conversation already used therefore resumes that provider's own transcript
 * instead of starting a third one.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  getConnection,
  sessionLegsDb,
  sessionsDb,
  type LegRow,
  type SessionRow,
} from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';
import { profilesService, type ProfileView } from '@/modules/profiles/profiles.service.js';
import { resolveProfileDir } from '@/modules/profiles/profile-env.js';
import { buildHandoffPrimer } from '@/modules/profiles/handoff-primer.js';
import { loadHandoffHistory, type LoadHandoffHistory } from '@/modules/profiles/handoff-seed.js';

/**
 * Declared here rather than reusing `HandoffResult` from `handoff.service.ts`:
 * that union describes outcomes that allocate or repoint a session row, and a
 * leg switch does neither. Keeping the two apart also keeps this module out of
 * the way while the service-level contract is reworked.
 */
export type LegHandoffStatus = 'leg-opened' | 'leg-resumed';

export interface LegHandoffResult {
  status: LegHandoffStatus;
  /** Always the original session: a leg switch never changes the app-facing id. */
  sessionId: string;
  profileId: string;
  primed: boolean;
}

/** Absolute path this session's primer for one leg is written to. */
export function resolveLegPrimerPath(
  target: ProfileView,
  sessionId: string,
  legSeq: number,
): string {
  // The leg's `seq` is part of the name because `session_id` no longer changes
  // across switches: without it, every switch on the same session would write
  // over the previous switch's primer.
  return path.join(
    resolveProfileDir(target.provider, target.slug),
    'handoff-seeds',
    `${sessionId}-${legSeq}.md`,
  );
}

/**
 * Refuses a target account that has not been signed in, before anything moves.
 *
 * The switch is only worth applying if the target can actually run a turn;
 * letting it through would park the conversation on a leg that cannot answer.
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

/** Names the account the conversation is coming from, when it still exists. */
function resolveSourceProfileName(session: SessionRow): string | null {
  if (!session.profile_id) {
    return null;
  }
  try {
    return profilesService.getProfile(session.profile_id).name;
  } catch {
    // The account that ran the previous leg may have been deleted since. The
    // primer is still worth handing over, just without the account attribution.
    return null;
  }
}

/**
 * SQLite stores `CURRENT_TIMESTAMP` as UTC with no zone suffix, which `Date`
 * would read as local time. Stamping the zone keeps the incremental cutoff from
 * sliding by the host's UTC offset and silently re-sending (or swallowing) turns.
 */
const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function toIsoCutoff(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const stamped = SQLITE_UTC_TIMESTAMP_REGEX.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = new Date(stamped);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * Whether a leg can still be resumed on the provider's own side.
 *
 * A leg whose transcript file was deleted (log rotation, a manual clean-up of
 * the provider's data dir) cannot be resumed natively: the CLI would reject the
 * id or answer with an empty conversation. Such a leg is left in place and the
 * switch degrades to a fresh one.
 */
function legTranscriptIsIntact(leg: LegRow): boolean {
  if (!leg.jsonl_path) {
    return true;
  }
  if (fs.existsSync(leg.jsonl_path)) {
    return true;
  }
  console.warn(
    `[handoff] transcript ${leg.jsonl_path} for leg ${leg.leg_id} is gone, opening a new leg instead`,
  );
  return false;
}

/**
 * Renders the primer, or null when there is nothing to hand over.
 *
 * The prior conversation is context, never a precondition: a history that is
 * empty, unreadable, or made entirely of tool traffic still yields a usable
 * leg — it simply starts clean, and the caller reports that.
 */
async function renderPrimer(
  session: SessionRow,
  target: ProfileView,
  loadHistory: LoadHandoffHistory,
  since: string | undefined,
): Promise<string | null> {
  try {
    const messages = await loadHistory(session.session_id);
    return await buildHandoffPrimer({
      messages,
      sourceProvider: session.provider,
      sourceProfileName: resolveSourceProfileName(session),
      since,
      destinationProvider: target.provider,
    });
  } catch (error) {
    console.error('[handoff] could not read the session history, switching without a primer:', error);
    return null;
  }
}

function writePrimer(primer: string, primerPath: string): string {
  fs.mkdirSync(path.dirname(primerPath), { recursive: true });
  fs.writeFileSync(primerPath, primer, 'utf8');
  return primerPath;
}

/**
 * Moves a session onto `target`, resuming that account's existing leg when it
 * has one and opening a new leg otherwise.
 *
 * The primer is rendered first, outside the transaction: it may call out to a
 * model to compress an overflowing history, and none of that may hold the
 * database. Everything that mutates state then runs in one transaction, so a
 * failure part-way leaves the session exactly where it was — on its previous leg.
 */
export async function applyCrossProviderSwitch(
  session: SessionRow,
  target: ProfileView,
  loadHistory: LoadHandoffHistory = loadHandoffHistory,
): Promise<LegHandoffResult> {
  assertTargetAuthenticated(target);

  const existingLeg = sessionLegsDb.findLeg(session.session_id, target.provider, target.id);
  const legToResume = existingLeg && legTranscriptIsIntact(existingLeg) ? existingLeg : null;

  // A resumed leg only needs what happened on the *other* legs while it was
  // away. A leg that was opened but never ran a turn has no such boundary — it
  // has seen none of the conversation — so it takes the full primer, same as a
  // leg opened for the first time.
  const since =
    legToResume && legToResume.provider_session_id ? toIsoCutoff(legToResume.ended_at) : undefined;

  const primer = await renderPrimer(session, target, loadHistory, since);

  const apply = getConnection().transaction(() => {
    let leg: LegRow;
    if (legToResume) {
      sessionLegsDb.activateLeg(session.session_id, legToResume.leg_id);
      leg = legToResume;
    } else {
      leg = sessionLegsDb.openLeg({
        sessionId: session.session_id,
        provider: target.provider,
        profileId: target.id,
        profileNameAtSwitch: target.name,
      });
    }

    // File first, pointer last: the writes below roll back on failure, a written
    // file does not. An orphan primer file is inert, while a `seed_primer_path`
    // pointing at a file that was never written breaks the next turn outright.
    const primerPath =
      primer === null
        ? null
        : writePrimer(primer, resolveLegPrimerPath(target, session.session_id, leg.seq));

    // A newly opened leg carries NULL for both native columns: it has no
    // transcript until the CLI announces its own id on the first turn.
    sessionsDb.repointActiveLeg(session.session_id, {
      provider: leg.provider,
      profileId: leg.profile_id,
      providerSessionId: leg.provider_session_id,
      jsonlPath: leg.jsonl_path,
    });
    // Cleared when there is no primer, so a primer left over from an earlier
    // switch is never delivered to a leg it was not written for.
    sessionsDb.updateSessionSeedPrimerPath(session.session_id, primerPath);

    return primerPath;
  });

  const primerPath = apply();

  return {
    status: legToResume ? 'leg-resumed' : 'leg-opened',
    sessionId: session.session_id,
    profileId: target.id,
    primed: primerPath !== null,
  };
}
