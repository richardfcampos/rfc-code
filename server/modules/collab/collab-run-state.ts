/**
 * The only status writes the round loop is allowed to make.
 *
 * Every one of them is a compare-and-set on `running`. A collaboration is
 * advanced by an in-process loop that spends minutes inside a single turn,
 * while a stop request can rewrite the same row from an HTTP handler at any
 * instant. An unconditional write from the loop would silently undo a stop the
 * user already saw applied — so the guard lives here, once, instead of on the
 * transitions somebody remembered to protect.
 */

import type { collabRepository } from './collab.repository.js';
import type { CouncilSummary } from './council-summary.js';
import type { CollaborationRow, CollaborationStatusPatch } from './collab.types.js';

/** Applies only while the run is still ours to advance. */
const WHILE_RUNNING = { onlyIfStatus: 'running' } as const;

export interface CollabRunState {
  /** The row while it is still running; `null` once anything else owns it. */
  read(id: string): CollaborationRow | null;
  /** Opens a round. `false` means the run ended and the loop must stop. */
  claimRound(id: string, round: number): boolean;
  /** Writes an outcome. `false` means the run had already ended elsewhere. */
  finish(id: string, patch: CollaborationStatusPatch): boolean;
  /**
   * Closes a run as failed. Never throws: `run()` is fire-and-forget.
   *
   * The summary is optional because a run can break before there is anything to
   * summarize; when there is, a failure is exactly when the reader most wants
   * to see what was already stated and what it cost.
   */
  fail(id: string, message: string, summary?: CouncilSummary): void;
}

export function createRunState(repository: typeof collabRepository): CollabRunState {
  const state: CollabRunState = {
    read(id: string): CollaborationRow | null {
      const row = repository.getById(id);
      return row && row.status === 'running' ? row : null;
    },

    claimRound(id: string, round: number): boolean {
      return state.finish(id, { status: 'running', currentRound: round });
    },

    finish(id: string, patch: CollaborationStatusPatch): boolean {
      return repository.updateStatus(id, patch, WHILE_RUNNING) !== null;
    },

    fail(id: string, message: string, summary?: CouncilSummary): void {
      try {
        // Spread rather than passed as undefined: the repository writes every
        // key it is given, and an explicit undefined would blank a summary.
        state.finish(id, {
          status: 'failed',
          error: message,
          ...(summary ? { summary } : {}),
        });
      } catch (error) {
        console.error('[collab] could not record collaboration failure:', error);
      }
    },
  };

  return state;
}
