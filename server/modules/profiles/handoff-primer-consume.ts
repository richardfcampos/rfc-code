/**
 * Delivery side of the cross-provider handoff primer.
 *
 * A session created by a cross-provider switch starts with no history of its
 * own: everything the conversation said so far lives in the *source* provider's
 * store and was rendered to a markdown file, whose path sits on
 * `sessions.seed_primer_path`. Nothing else reads that column, so this is the
 * one place the handed-over context becomes visible to the target model.
 *
 * The pointer is single-use. It is cleared as part of consuming it, which is
 * what keeps the primer out of every turn after the first — re-sending it would
 * duplicate context the model already has and grow every prompt for the rest of
 * the session.
 */

import fs from 'node:fs';

import { sessionsDb, type SessionRow } from '@/modules/database/index.js';

/**
 * Returns the pending primer for `session`, clearing the pointer, or null.
 *
 * Never throws. The primer is context, never a precondition: a file that was
 * deleted, truncated or made unreadable must degrade to "this session starts
 * clean", not fail the user's turn. The pointer is cleared in both outcomes, so
 * a path that can no longer be read cannot wedge the session into retrying the
 * same broken file on every message.
 *
 * Synchronous on purpose — one file read plus one UPDATE, on a code path that
 * is about to spawn a provider runtime anyway.
 */
export function consumePendingPrimer(session: SessionRow): string | null {
  const primerPath = session.seed_primer_path;
  if (!primerPath) {
    // The overwhelming majority of sessions never came from a handoff: one
    // column check and they are out, with no file or database access.
    return null;
  }

  let primer: string | null = null;
  try {
    const contents = fs.readFileSync(primerPath, 'utf8');
    // A blank file carries no context; treating it as "none" avoids prefixing
    // the prompt with a bare separator.
    primer = contents.trim().length > 0 ? contents : null;
  } catch (error) {
    console.error('[handoff] seeded primer could not be read, continuing without it:', error);
  }

  try {
    sessionsDb.updateSessionSeedPrimerPath(session.session_id, null);
  } catch (error) {
    // The primer is still handed over: a failed UPDATE means the database is
    // in trouble, and dropping the context would not fix that. Worst case the
    // primer is offered again on the next turn.
    console.error('[handoff] seeded primer pointer could not be cleared:', error);
  }

  return primer;
}
