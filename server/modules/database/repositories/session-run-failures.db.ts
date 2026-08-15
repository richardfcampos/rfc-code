import { getConnection } from '@/modules/database/connection.js';

export type SessionRunFailureRow = {
  failure_id: number;
  session_id: string;
  provider: string;
  error_message: string;
  exit_code: number | null;
  failed_at: string;
};

/**
 * Per-session cap. A session that keeps failing (expired login, plan limit
 * reached on every retry) would otherwise accumulate one row per attempt
 * forever; the newest failures are the ones that explain the current state.
 */
const MAX_FAILURES_PER_SESSION = 50;

/** Longest error text kept — providers can return whole stack traces. */
const MAX_ERROR_MESSAGE_LENGTH = 2000;

export const sessionRunFailuresDb = {
  /**
   * Records why a run ended badly. Called once per failed run, from the
   * terminal `complete` event, so a reload or a reconnect after the live
   * websocket event was missed can still explain the stop.
   */
  recordFailure(entry: {
    sessionId: string;
    provider: string;
    errorMessage: string;
    exitCode?: number | null;
    failedAt?: Date;
  }): void {
    const message = entry.errorMessage.trim();
    if (!entry.sessionId || !message) {
      return;
    }

    const db = getConnection();
    const failedAt = (entry.failedAt ?? new Date()).toISOString();

    db.prepare(`
      INSERT INTO session_run_failures (session_id, provider, error_message, exit_code, failed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      entry.sessionId,
      entry.provider,
      message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
      entry.exitCode ?? null,
      failedAt,
    );

    db.prepare(`
      DELETE FROM session_run_failures
      WHERE session_id = ?
        AND failure_id NOT IN (
          SELECT failure_id FROM session_run_failures
          WHERE session_id = ?
          ORDER BY failed_at DESC, failure_id DESC
          LIMIT ?
        )
    `).run(entry.sessionId, entry.sessionId, MAX_FAILURES_PER_SESSION);
  },

  /** Failures for one session, oldest first so they merge into history order. */
  listBySession(sessionId: string): SessionRunFailureRow[] {
    if (!sessionId) {
      return [];
    }

    return getConnection()
      .prepare(`
        SELECT failure_id, session_id, provider, error_message, exit_code, failed_at
        FROM session_run_failures
        WHERE session_id = ?
        ORDER BY failed_at ASC, failure_id ASC
      `)
      .all(sessionId) as SessionRunFailureRow[];
  },

  /** Drops a session's failures — used when its history is deleted. */
  deleteBySession(sessionId: string): void {
    if (!sessionId) {
      return;
    }

    getConnection()
      .prepare('DELETE FROM session_run_failures WHERE session_id = ?')
      .run(sessionId);
  },
};
