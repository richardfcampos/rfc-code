/**
 * Persistence for the transcript of a collaboration.
 *
 * Split from the collaboration rows because the two tables are written for
 * opposite reasons: a collaboration is a status machine rewritten in place
 * while turns are append-only and read in order. `collabRepository` composes
 * both halves, so callers still deal with a single repository.
 */

import { normalizeSqliteTimestamp } from '@/modules/collab/collab.types.js';
import { getConnection } from '@/modules/database/index.js';
import type { AppendTurnInput, CollaborationTurnRow } from '@/modules/collab/collab.types.js';

const TURN_COLUMNS =
  'id, collaboration_id, round, turn_index, profile_id, role, content, consensus, error, contract, contract_error, input_tokens, output_tokens, created_at';

function normalizeTurnRow(row: CollaborationTurnRow): CollaborationTurnRow {
  return { ...row, created_at: normalizeSqliteTimestamp(row.created_at) };
}

export const collabTurnsRepository = {
  /**
   * Turns in playback order. `created_at` alone is not enough: several turns of
   * the same round can land inside the same one-second SQLite tick, so the
   * explicit round/index pair is what guarantees a stable transcript.
   */
  listTurns(collaborationId: string): CollaborationTurnRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${TURN_COLUMNS} FROM collaboration_turns
         WHERE collaboration_id = ?
         ORDER BY round ASC, turn_index ASC, created_at ASC`,
      )
      .all(collaborationId) as CollaborationTurnRow[];

    return rows.map(normalizeTurnRow);
  },

  /**
   * Records a finished turn and touches the parent's `updated_at` in one
   * transaction, so a poller can never see a fresh turn attached to a
   * collaboration that still claims it has not moved.
   *
   * The parent is touched first because that write doubles as an existence
   * check: a turn finishing after its collaboration was deleted would otherwise
   * insert a row nothing lists and no cascade will ever reach. `null` means the
   * parent is gone and the turn was dropped.
   */
  appendTurn(turn: AppendTurnInput): CollaborationTurnRow | null {
    const db = getConnection();
    // Absent and explicit-null both mean "this turn did not vote".
    const consensus = turn.consensus == null ? null : Number(turn.consensus);

    const write = db.transaction((): boolean => {
      const touched = db
        .prepare('UPDATE collaborations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(turn.collaborationId).changes;
      if (touched === 0) return false;

      db.prepare(
        `INSERT INTO collaboration_turns
           (id, collaboration_id, round, turn_index, profile_id, role, content, consensus, error,
            contract, contract_error, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        turn.id,
        turn.collaborationId,
        turn.round,
        turn.turnIndex,
        turn.profileId,
        turn.role,
        turn.content,
        consensus,
        turn.error ?? null,
        turn.contract ? JSON.stringify(turn.contract) : null,
        turn.contractError ?? null,
        // A turn nobody metered stores NULL in both columns rather than zeros,
        // so "not reported" never reads as "produced nothing".
        turn.usage?.inputTokens ?? null,
        turn.usage?.outputTokens ?? null,
      );
      return true;
    });

    if (!write()) return null;

    const row = db
      .prepare(`SELECT ${TURN_COLUMNS} FROM collaboration_turns WHERE id = ?`)
      .get(turn.id) as CollaborationTurnRow;
    return normalizeTurnRow(row);
  },

  /** Removes a whole transcript; the collaboration row is deleted separately. */
  deleteTurnsOf(collaborationId: string): void {
    getConnection()
      .prepare('DELETE FROM collaboration_turns WHERE collaboration_id = ?')
      .run(collaborationId);
  },
};
