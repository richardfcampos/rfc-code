import type { Database } from 'better-sqlite3';

import { getConnection } from '@/modules/database/connection.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { sessionLegsDb } from '@/modules/database/repositories/session-legs.db.js';
import { normalizeProjectPath } from '@/shared/utils.js';

export type SessionRow = {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  project_path: string | null;
  jsonl_path: string | null;
  custom_name: string | null;
  profile_id: string | null;
  caveman_mode: string | null;
  isArchived: number;
  created_at: string;
  updated_at: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  seed_primer_path: string | null;
};

const SESSION_ROW_COLUMNS =
  'session_id, provider, provider_session_id, project_path, jsonl_path, custom_name, profile_id, caveman_mode, isArchived, created_at, updated_at, worktree_path, worktree_branch, seed_primer_path';

const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function normalizeTimestamp(value?: string): string | null {
  if (!value) return null;

  // SQLite CURRENT_TIMESTAMP is stored as UTC without a timezone suffix.
  // Normalize it here so every session reader returns canonical ISO strings
  // and the sidebar never interprets fresh rows as local-time "hours old".
  const normalizedValue = SQLITE_UTC_TIMESTAMP_REGEX.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;

  const parsed = new Date(normalizedValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeSessionRow<T extends SessionRow | null | undefined>(row: T): T {
  if (!row) {
    return row;
  }

  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at) ?? row.created_at,
    updated_at: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  };
}

function normalizeSessionRows(rows: SessionRow[]): SessionRow[] {
  return rows.map((row) => normalizeSessionRow(row) as SessionRow);
}

function normalizeProjectPathForProvider(provider: string, projectPath: string): string {
  void provider;
  return normalizeProjectPath(projectPath);
}

function selectSessionById(db: Database, sessionId: string): SessionRow | null {
  const row = db
    .prepare(
      `SELECT ${SESSION_ROW_COLUMNS}
       FROM sessions
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(sessionId) as SessionRow | undefined;

  return normalizeSessionRow(row) ?? null;
}

export const sessionsDb = {
  /**
   * Upserts one session row discovered on disk by a provider synchronizer.
   *
   * The given id is the provider-native session id. Rows are keyed by
   * `provider_session_id` so a session that was first created by the app
   * (with an app-allocated `session_id`) is updated in place once its
   * transcript shows up on disk, instead of producing a duplicate row.
   *
   * `worktreePath`/`worktreeBranch` come from resolving the session's `cwd`
   * against its repository (done by the caller, not here). They always
   * overwrite the previous value rather than COALESCE-ing: unlike
   * `customName`/`profileId`, which are user-set and should survive a sync
   * pass that doesn't know them, the worktree pair reflects the *current*
   * git state, so a session that stopped running in a worktree must fall
   * back to NULL on the next resolution instead of keeping a stale badge.
   */
  createSession(
    providerSessionId: string,
    provider: string,
    projectPath: string,
    customName?: string,
    createdAt?: string,
    updatedAt?: string,
    jsonlPath?: string | null,
    profileId?: string | null,
    worktreePath?: string | null,
    worktreeBranch?: string | null
  ): string {
    const db = getConnection();
    const createdAtValue = normalizeTimestamp(createdAt);
    const updatedAtValue = normalizeTimestamp(updatedAt);
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
    const profileIdValue = profileId ?? null;
    const worktreePathValue = worktreePath ?? null;
    const worktreeBranchValue = worktreeBranch ?? null;

    // First, ensure the project path is recorded in the projects table,
    // since it's a foreign key in the sessions table. Only the resolved repo
    // root is ever passed here — never the worktree path — so no project row
    // is ever created for a worktree directory.
    projectsDb.createProjectPath(normalizedProjectPath);

    const existing = db
      .prepare(
        `SELECT session_id FROM sessions
         WHERE provider_session_id = ? AND provider = ?
         LIMIT 1`
      )
      .get(providerSessionId, provider) as { session_id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE sessions SET
           provider = ?,
           updated_at = COALESCE(?, CURRENT_TIMESTAMP),
           project_path = ?,
           jsonl_path = ?,
           isArchived = 0,
           custom_name = COALESCE(?, custom_name),
           profile_id = COALESCE(?, profile_id),
           worktree_path = ?,
           worktree_branch = ?
         WHERE session_id = ?`
      ).run(
        provider,
        updatedAtValue,
        normalizedProjectPath,
        jsonlPath ?? null,
        customName ?? null,
        profileIdValue,
        worktreePathValue,
        worktreeBranchValue,
        existing.session_id
      );

      return existing.session_id;
    }

    // Sessions created outside the app (directly via the provider CLI) are
    // keyed by the provider-native id for both columns. The ON CONFLICT path
    // covers legacy rows that predate the provider_session_id mapping.
    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, profile_id, worktree_path, worktree_branch, isArchived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(session_id) DO UPDATE SET
         provider = excluded.provider,
         provider_session_id = excluded.provider_session_id,
         updated_at = excluded.updated_at,
         project_path = excluded.project_path,
         jsonl_path = excluded.jsonl_path,
         isArchived = 0,
         custom_name = COALESCE(excluded.custom_name, sessions.custom_name),
         profile_id = COALESCE(excluded.profile_id, sessions.profile_id),
         worktree_path = excluded.worktree_path,
         worktree_branch = excluded.worktree_branch`
    ).run(
      providerSessionId,
      provider,
      providerSessionId,
      customName ?? null,
      normalizedProjectPath,
      jsonlPath ?? null,
      profileIdValue,
      worktreePathValue,
      worktreeBranchValue,
      createdAtValue,
      updatedAtValue
    );

    return providerSessionId;
  },

  /**
   * Inserts one app-allocated session row before any provider run happens.
   *
   * The session gateway uses this when the frontend starts a brand-new chat:
   * `session_id` is the stable app-facing id, while `provider_session_id`
   * stays NULL until the provider runtime announces its own id and
   * `assignProviderSessionId` records the mapping. An optional `profileId`
   * stamps which account profile owns the session from creation, so the
   * websocket dispatch (and the session header badge) know which account is
   * in use without waiting for a synchronizer pass to discover it on disk.
   *
   * `worktreePath`/`worktreeBranch` are the resolved pair for the `cwd` the
   * session was started with; `projectPath` must already be the repo root,
   * never the worktree directory, so no project row is created for it.
   */
  createAppSession(
    sessionId: string,
    provider: string,
    projectPath: string,
    profileId?: string | null,
    worktreePath?: string | null,
    worktreeBranch?: string | null
  ): string {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);

    projectsDb.createProjectPath(normalizedProjectPath);

    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, profile_id, worktree_path, worktree_branch, isArchived, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, NULL, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(
      sessionId,
      provider,
      normalizedProjectPath,
      profileId ?? null,
      worktreePath ?? null,
      worktreeBranch ?? null
    );

    return sessionId;
  },

  /**
   * Records the provider-native session id for one app-allocated session.
   *
   * If the filesystem watcher indexed the provider transcript before this
   * mapping was recorded (a duplicate row keyed by the provider id exists),
   * the duplicate is merged into the app row: its transcript path and name
   * are adopted and the duplicate row is removed. Runs in a transaction so
   * the sidebar can never observe both rows at once.
   *
   * The same provider id and transcript path are also stamped onto the
   * session's currently-active leg, in the same transaction, so `sessions`
   * and `session_legs` never disagree about the active provider_session_id
   * even if the process crashes mid-write.
   */
  assignProviderSessionId(sessionId: string, providerSessionId: string): void {
    const db = getConnection();

    const merge = db.transaction(() => {
      const duplicate = db
        .prepare(
          `SELECT ${SESSION_ROW_COLUMNS} FROM sessions
           WHERE (session_id = ? OR provider_session_id = ?)
             AND session_id <> ?
           LIMIT 1`
        )
        .get(providerSessionId, providerSessionId, sessionId) as SessionRow | undefined;

      if (duplicate) {
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(duplicate.session_id);
        db.prepare(
          `UPDATE sessions SET
             provider_session_id = ?,
             jsonl_path = COALESCE(jsonl_path, ?),
             custom_name = COALESCE(custom_name, ?),
             updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ?`
        ).run(providerSessionId, duplicate.jsonl_path, duplicate.custom_name, sessionId);
      } else {
        db.prepare(
          `UPDATE sessions SET
             provider_session_id = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ?`
        ).run(providerSessionId, sessionId);
      }

      const activeLeg = sessionLegsDb.listLegs(sessionId).find((leg) => leg.ended_at === null);
      if (!activeLeg) {
        return;
      }

      const resolvedSession = selectSessionById(db, sessionId);
      sessionLegsDb.attachProviderSessionId(
        activeLeg.leg_id,
        providerSessionId,
        resolvedSession?.jsonl_path ?? null
      );
    });

    merge();
  },

  updateSessionCustomName(sessionId: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET custom_name = ?
       WHERE session_id = ?`
    ).run(customName, sessionId);
  },

  /**
   * Rebinds a session to a different account profile (mid-session handoff).
   * Passing null returns the session to the provider CLI's default config dir.
   */
  updateSessionProfileId(sessionId: string, profileId: string | null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET profile_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(profileId ?? null, sessionId);
  },

  /**
   * Overrides the response-compression level for one session.
   *
   * Passing null clears the override so the session follows its profile again.
   */
  updateSessionCavemanMode(sessionId: string, cavemanMode: string | null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET caveman_mode = ?, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(cavemanMode ?? null, sessionId);
  },

  /**
   * Points a session at its on-disk transcript. Used when a degraded handoff
   * seeds a brand-new session whose transcript is written by the app rather
   * than discovered by a synchronizer.
   */
  updateSessionJsonlPath(sessionId: string, jsonlPath: string | null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET jsonl_path = ?, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(jsonlPath ?? null, sessionId);
  },

  /**
   * Projects the currently-active leg onto the session row.
   *
   * A session spans several provider legs, but the row must always describe the
   * one that is live: the dispatcher reads `provider`/`profile_id` to pick the
   * adapter and account, and `provider_session_id`/`jsonl_path` to resume the
   * native transcript. The four move together — a row carrying one leg's
   * provider next to another leg's transcript id would resume the wrong
   * conversation — so they are written in a single statement.
   */
  repointActiveLeg(
    sessionId: string,
    fields: {
      provider: string;
      profileId: string | null;
      providerSessionId: string | null;
      jsonlPath: string | null;
    }
  ): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET provider = ?,
           profile_id = ?,
           provider_session_id = ?,
           jsonl_path = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(
      fields.provider,
      fields.profileId,
      fields.providerSessionId,
      fields.jsonlPath,
      sessionId
    );
  },

  /**
   * Points a session at its pending cross-provider context primer, or clears
   * it. A handoff writes the primer file and stores its path here; the next
   * turn reads the path, prefixes the primer to the outgoing prompt, then
   * clears the path so the primer reaches the model exactly once.
   */
  updateSessionSeedPrimerPath(sessionId: string, seedPrimerPath: string | null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET seed_primer_path = ?, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(seedPrimerPath ?? null, sessionId);
  },

  getSessionById(sessionId: string): SessionRow | null {
    const db = getConnection();
    return selectSessionById(db, sessionId);
  },

  /**
   * Resolves one session row through the provider-native id.
   *
   * The filesystem watcher only knows provider ids (they come from transcript
   * file names), so it uses this lookup to translate disk artifacts back to
   * the app-facing session row before broadcasting sidebar updates.
   *
   * A provider id that belonged to a previous, now-inactive leg of a session
   * no longer lives on `sessions.provider_session_id` (only the active leg's
   * id does), so a miss here falls back to `session_legs` before giving up —
   * otherwise the watcher would mistake that leg's transcript for an unmapped
   * session and create a phantom duplicate row.
   */
  getSessionByProviderSessionId(providerSessionId: string): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider_session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(providerSessionId) as SessionRow | undefined;

    const direct = normalizeSessionRow(row) ?? null;
    if (direct) {
      return direct;
    }

    const legSessionId = sessionLegsDb.findSessionIdByProviderSessionId(providerSessionId);
    if (!legSessionId) {
      return null;
    }

    return selectSessionById(db, legSessionId);
  },

  /**
   * Finds the newest app-created session for a project that is still waiting
   * for its provider-native id to be recorded.
   *
   * Primary intention: OpenCode can expose a new session in its shared
   * `opencode.db` before the websocket runtime reports that same provider id
   * back to our app. At that moment the sidebar already has an optimistic
   * app-owned session row, but the watcher only knows the provider-native id.
   *
   * Without this lookup, the synchronizer would insert a second row keyed by
   * the provider id, then `assignProviderSessionId()` would merge it a moment
   * later. That eventually self-heals, but on slow networks the user can still
   * briefly see two sidebar sessions for the same conversation.
   *
   * This helper lets the synchronizer claim the pending app row first, so the
   * provider id is attached before any watcher-created row exists. The result
   * is simpler than frontend dedupe and keeps the race resolved at the source.
   */
  findLatestPendingAppSession(provider: string, projectPath: string): SessionRow | null {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider = ?
           AND project_path = ?
           AND provider_session_id IS NULL
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT 1`
      )
      .get(provider, normalizedProjectPath) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  getAllSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 0`
      )
      .all() as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Archived rows are intentionally queried separately so the caller can render
   * them in a dedicated view without reintroducing them into active session lists.
   */
  getArchivedSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 1
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC`
      )
      .all() as SessionRow[];

    return normalizeSessionRows(rows);
  },

  getSessionsByProjectPath(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0`
      )
      .all(normalizedProjectPath) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Permanent project deletion must see every session row for the path,
   * including archived ones, so their transcript files can be cleaned up.
   */
  getSessionsByProjectPathIncludingArchived(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?`
      )
      .all(normalizedProjectPath) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  getSessionsByProjectPathPage(projectPath: string, limit: number, offset: number): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(normalizedProjectPath, limit, offset) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  countSessionsByProjectPath(projectPath: string): number {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0`
      )
      .get(normalizedProjectPath) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  },

  deleteSessionsByProjectPath(projectPath: string): void {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);

    const deleteAll = db.transaction(() => {
      // Must run before the sessions DELETE below: the subquery resolves
      // which sessions belong to this project by joining against the
      // sessions table, which would no longer have those rows to match
      // against if it ran second.
      db.prepare(
        `DELETE FROM session_legs
         WHERE session_id IN (SELECT session_id FROM sessions WHERE project_path = ?)`
      ).run(normalizedProjectPath);

      db.prepare(`DELETE FROM sessions WHERE project_path = ?`).run(normalizedProjectPath);
    });

    deleteAll();
  },

  getSessionName(sessionId: string, provider: string): string | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT custom_name
         FROM sessions
         WHERE session_id = ? AND provider = ?`
      )
      .get(sessionId, provider) as { custom_name: string | null } | undefined;

    return row?.custom_name ?? null;
  },

  /**
   * Soft-delete and restore both use the same flag update so callers keep the
   * row, metadata, and file path intact while toggling visibility.
   */
  updateSessionIsArchived(sessionId: string, isArchived: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET isArchived = ?
       WHERE session_id = ?`
    ).run(isArchived ? 1 : 0, sessionId);
  },

  deleteSessionById(sessionId: string): boolean {
    const db = getConnection();

    const deleteOne = db.transaction(() => {
      db.prepare('DELETE FROM session_legs WHERE session_id = ?').run(sessionId);
      return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0;
    });

    return deleteOne();
  },
};
