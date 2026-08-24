import { getConnection } from '@/modules/database/connection.js';

export type ActiveSessionRunRow = {
  session_id: string;
  provider: string;
  started_at: string;
};

/**
 * Markers for runs that are in flight right now.
 *
 * A run lives in an in-memory registry, so a SIGKILL, an OOM kill or a crash
 * takes it down with no chance to record anything: the session simply stops and
 * its history has nothing to show for it. This table is the durable half of
 * that registry — one row while a run is alive, removed the moment it ends —
 * so the next boot can see which runs the dead process left behind.
 *
 * Only what the boot sweep needs is kept here. This is not a run log; a run
 * that ended is a deleted row, not a row with a status.
 */
export const activeSessionRunsDb = {
  /** Marks a run as in flight, replacing any stale marker for the session. */
  markStarted(entry: { sessionId: string; provider: string; startedAt?: Date }): void {
    if (!entry.sessionId) {
      return;
    }

    getConnection()
      .prepare(`
        INSERT INTO active_session_runs (session_id, provider, started_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          provider = excluded.provider,
          started_at = excluded.started_at
      `)
      .run(entry.sessionId, entry.provider, (entry.startedAt ?? new Date()).toISOString());
  },

  /** Removes a session's marker once its run has ended, however it ended. */
  clear(sessionId: string): void {
    if (!sessionId) {
      return;
    }

    getConnection()
      .prepare('DELETE FROM active_session_runs WHERE session_id = ?')
      .run(sessionId);
  },

  /** Every marker still on record, oldest run first. */
  listAll(): ActiveSessionRunRow[] {
    return getConnection()
      .prepare(`
        SELECT session_id, provider, started_at
        FROM active_session_runs
        ORDER BY started_at ASC, session_id ASC
      `)
      .all() as ActiveSessionRunRow[];
  },

  /**
   * Drops every marker. Called once at boot after the leftovers have been
   * turned into failures: no run can be alive while the process is still
   * starting, so anything left is by definition stale.
   */
  clearAll(): void {
    getConnection().prepare('DELETE FROM active_session_runs').run();
  },
};
