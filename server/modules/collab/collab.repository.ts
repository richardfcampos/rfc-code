/**
 * Persistence for collaborations, composed with the transcript half from
 * `collab-turns.repository.ts`.
 *
 * Lives inside the collab module (not the shared repositories folder) so every
 * piece of multi-account collaboration logic sits together. It deals in raw
 * rows only: it never resolves profile names and never decides convergence,
 * which keeps the engine free to be tested against a fake runtime and the
 * service free to enrich rows before they reach HTTP.
 */

import { collabTurnsRepository } from '@/modules/collab/collab-turns.repository.js';
import { normalizeSqliteTimestamp } from '@/modules/collab/collab.types.js';
import { getConnection } from '@/modules/database/index.js';
import type {
  CollabStatus,
  CollaborationRow,
  CollaborationStatusPatch,
  InsertCollaborationInput,
} from '@/modules/collab/collab.types.js';

export interface UpdateStatusOptions {
  /** Write only while the stored status still matches, i.e. compare-and-set. */
  onlyIfStatus?: CollabStatus;
}

const COLLABORATION_COLUMNS =
  'id, topic, mode, project_path, status, max_rounds, current_round, participants, verdict, error, budget, summary, created_at, updated_at';

const ORPHANED_RUN_ERROR = 'Server restarted while this collaboration was running.';

function normalizeCollaborationRow(row: CollaborationRow): CollaborationRow {
  return {
    ...row,
    created_at: normalizeSqliteTimestamp(row.created_at),
    updated_at: normalizeSqliteTimestamp(row.updated_at),
  };
}

export const collabRepository = {
  ...collabTurnsRepository,

  insert(collaboration: InsertCollaborationInput): CollaborationRow {
    const db = getConnection();
    db.prepare(
      `INSERT INTO collaborations
         (id, topic, mode, project_path, status, max_rounds, current_round, participants, budget)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      collaboration.id,
      collaboration.topic,
      collaboration.mode,
      collaboration.projectPath,
      collaboration.status ?? 'running',
      collaboration.maxRounds,
      collaboration.currentRound ?? 0,
      JSON.stringify(collaboration.participants),
      // NULL rather than a serialized default: an absent budget is read back as
      // the defaults for the run's shape, so the two states stay one state.
      collaboration.budget ? JSON.stringify(collaboration.budget) : null,
    );

    // Read back so the caller sees the DB-assigned timestamps.
    return collabRepository.getById(collaboration.id) as CollaborationRow;
  },

  getById(id: string): CollaborationRow | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${COLLABORATION_COLUMNS} FROM collaborations WHERE id = ?`)
      .get(id) as CollaborationRow | undefined;
    return row ? normalizeCollaborationRow(row) : null;
  },

  /** Newest first: the panel reads this as a run history. */
  list(projectPath?: string): CollaborationRow[] {
    const db = getConnection();
    const filter = projectPath ? 'WHERE project_path = ?' : '';
    const params = projectPath ? [projectPath] : [];
    const rows = db
      .prepare(
        `SELECT ${COLLABORATION_COLUMNS} FROM collaborations ${filter}
         ORDER BY created_at DESC, id DESC`,
      )
      .all(...params) as CollaborationRow[];

    return rows.map(normalizeCollaborationRow);
  },

  /**
   * Applies a status transition. Only the keys present are written, so
   * recording a verdict never wipes an error message and vice versa.
   *
   * With `onlyIfStatus` the write becomes a compare-and-set. The round loop
   * advances a run over minutes of model calls while the stop route can rewrite
   * the same row at any instant; unguarded, the loop's next write would silently
   * undo a stop the user already saw take effect. `null` means nothing was
   * written — the row is gone, or somebody else moved it first.
   */
  updateStatus(
    id: string,
    patch: CollaborationStatusPatch,
    options: UpdateStatusOptions = {},
  ): CollaborationRow | null {
    const db = getConnection();
    const assignments = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values: (string | number | null)[] = [patch.status];

    if ('verdict' in patch) {
      assignments.push('verdict = ?');
      values.push(patch.verdict ?? null);
    }
    if ('error' in patch) {
      assignments.push('error = ?');
      values.push(patch.error ?? null);
    }
    if (patch.currentRound !== undefined) {
      assignments.push('current_round = ?');
      values.push(patch.currentRound);
    }
    if ('summary' in patch) {
      assignments.push('summary = ?');
      values.push(patch.summary ? JSON.stringify(patch.summary) : null);
    }

    const conditions = ['id = ?'];
    values.push(id);
    if (options.onlyIfStatus !== undefined) {
      conditions.push('status = ?');
      values.push(options.onlyIfStatus);
    }

    const written = db
      .prepare(
        `UPDATE collaborations SET ${assignments.join(', ')} WHERE ${conditions.join(' AND ')}`,
      )
      .run(...values).changes;

    return written === 0 ? null : collabRepository.getById(id);
  },

  /**
   * Deletes a collaboration with its transcript. The turns are removed
   * explicitly instead of trusting the cascade, because `PRAGMA foreign_keys`
   * is per-connection and an orphaned transcript would survive forever.
   */
  deleteById(id: string): boolean {
    const db = getConnection();
    const remove = db.transaction(() => {
      collabTurnsRepository.deleteTurnsOf(id);
      return db.prepare('DELETE FROM collaborations WHERE id = ?').run(id).changes > 0;
    });
    return remove();
  },

  /**
   * Nothing resumes a collaboration after a restart: the in-memory engine loop
   * died with the process. Rows left in `running` are closed as failures at
   * boot so the UI never polls a run that will never advance.
   */
  failOrphanedRuns(): number {
    const db = getConnection();
    return db
      .prepare(
        `UPDATE collaborations
         SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE status = 'running'`,
      )
      .run(ORPHANED_RUN_ERROR).changes;
  },
};
