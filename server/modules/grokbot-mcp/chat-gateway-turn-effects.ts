/**
 * What the chat socket does around a turn besides spawning it, replicated so a
 * turn sent by the bot leaves the session in the same state a typed one would:
 * the first prompt names the session, a handed-over conversation's primer is
 * consumed exactly once, and an account switch asked for mid-turn is deferred
 * until the turn ends instead of landing on top of a live stream.
 */

import type { SessionRow } from '@/modules/database/index.js';
import { consumePendingPrimer, handoffService } from '@/modules/profiles/index.js';
import { ensureSessionTitle } from '@/modules/providers/index.js';

/** Same separator the chat socket puts between a primer and the user's words. */
const PRIMER_SEPARATOR = '\n\n---\n\n';

export type TurnEffects = {
  /** Runs once the run is claimed; returns the command the runtime should receive. */
  begin(session: SessionRow, prompt: string, profileId: string | null): string;
  /** Runs when the runtime settles, whatever happened. */
  end(sessionId: string): void;
};

export const defaultTurnEffects: TurnEffects = {
  begin(session, prompt, profileId) {
    void ensureSessionTitle({
      sessionId: session.session_id,
      prompt,
      cwd: session.worktree_path ?? session.project_path,
      profileId,
    });
    // Consumed only after the run is claimed, like the socket does: a branch
    // that bails out earlier must not clear the pointer unread.
    const primer = consumePendingPrimer(session);
    handoffService.markSessionRunning(session.session_id);
    return primer === null ? prompt : `${primer}${PRIMER_SEPARATOR}${prompt}`;
  },
  end(sessionId) {
    handoffService.markSessionIdle(sessionId);
    void handoffService
      .drainPendingSwitch(sessionId)
      .then((result) => {
        if (result) {
          console.log('[grokbot-mcp] applied a deferred account switch', { sessionId, status: result.status });
        }
      })
      .catch((error: unknown) => {
        console.error('[grokbot-mcp] deferred account switch failed to apply', { sessionId, error });
      });
  },
};
