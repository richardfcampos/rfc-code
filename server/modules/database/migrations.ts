import { readFileSync } from 'node:fs';

import { Database } from 'better-sqlite3';

import {
  APP_CONFIG_TABLE_SCHEMA_SQL,
  COLLABORATIONS_TABLE_SCHEMA_SQL,
  COLLABORATION_TURNS_TABLE_SCHEMA_SQL,
  LAST_SCANNED_AT_SQL,
  NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL,
  PROFILES_TABLE_SCHEMA_SQL,
  PROJECTS_TABLE_SCHEMA_SQL,
  PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL,
  SESSION_LEGS_TABLE_SCHEMA_SQL,
  SESSION_RUN_FAILURES_TABLE_SCHEMA_SQL,
  SESSIONS_TABLE_SCHEMA_SQL,
  USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL,
  VAPID_KEYS_TABLE_SCHEMA_SQL,
} from '@/modules/database/schema.js';

const SQLITE_UUID_SQL = `
lower(hex(randomblob(4))) || '-' ||
lower(hex(randomblob(2))) || '-' ||
lower(hex(randomblob(2))) || '-' ||
lower(hex(randomblob(2))) || '-' ||
lower(hex(randomblob(6)))
`;

type TableInfoRow = {
  name: string;
  pk: number;
};

const addColumnToTableIfNotExists = (
  db: Database,
  tableName: string,
  columnNames: string[],
  columnName: string,
  columnType: string
) => {
  if (!columnNames.includes(columnName)) {
    console.log(`Running migration: Adding ${columnName} column to ${tableName} table`);
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
};

const tableExists = (db: Database, tableName: string): boolean =>
  Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );

const getTableInfo = (db: Database, tableName: string): TableInfoRow[] =>
  db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];

const migrateLegacySessionNames = (db: Database): void => {
  const hasLegacySessionNamesTable = tableExists(db, 'session_names');
  const hasSessionsTable = tableExists(db, 'sessions');

  if (!hasLegacySessionNamesTable) {
    return;
  }

  if (hasSessionsTable) {
    console.log('Running migration: Merging session_names into sessions');
    db.exec(`
      INSERT INTO sessions (session_id, provider, custom_name, created_at, updated_at)
      SELECT
        session_id,
        COALESCE(provider, 'claude'),
        custom_name,
        COALESCE(created_at, CURRENT_TIMESTAMP),
        COALESCE(updated_at, CURRENT_TIMESTAMP)
      FROM session_names
      WHERE true
      ON CONFLICT(session_id) DO UPDATE SET
        provider = excluded.provider,
        custom_name = COALESCE(excluded.custom_name, sessions.custom_name),
        created_at = COALESCE(sessions.created_at, excluded.created_at),
        updated_at = COALESCE(excluded.updated_at, sessions.updated_at)
    `);
    db.exec('DROP TABLE session_names');
    return;
  }

  console.log('Running migration: Renaming session_names table to sessions');
  db.exec('ALTER TABLE session_names RENAME TO sessions');
};

const migrateLegacyWorkspaceTableIntoProjects = (db: Database): void => {
  db.exec(PROJECTS_TABLE_SCHEMA_SQL);

  if (!tableExists(db, 'workspace_original_paths')) {
    return;
  }

  console.log('Running migration: Migrating workspace_original_paths data into projects');
  db.exec(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived)
    SELECT
      CASE
        WHEN workspace_id IS NULL OR trim(workspace_id) = ''
        THEN ${SQLITE_UUID_SQL}
        ELSE workspace_id
      END,
      workspace_path,
      custom_workspace_name,
      COALESCE(isStarred, 0),
      0
    FROM workspace_original_paths
    WHERE workspace_path IS NOT NULL AND trim(workspace_path) <> ''
    ON CONFLICT(project_path) DO UPDATE SET
      custom_project_name = COALESCE(projects.custom_project_name, excluded.custom_project_name),
      isStarred = COALESCE(projects.isStarred, excluded.isStarred)
  `);
};

const rebuildProjectsTableWithPrimaryKeySchema = (db: Database): void => {
  const hasProjectsTable = tableExists(db, 'projects');
  if (!hasProjectsTable) {
    db.exec(PROJECTS_TABLE_SCHEMA_SQL);
    return;
  }

  const projectsTableInfo = getTableInfo(db, 'projects');
  const columnNames = projectsTableInfo.map((column) => column.name);
  const hasProjectIdPrimaryKey = projectsTableInfo.some(
    (column) => column.name === 'project_id' && column.pk === 1,
  );

  if (hasProjectIdPrimaryKey) {
    addColumnToTableIfNotExists(db, 'projects', columnNames, 'custom_project_name', 'TEXT DEFAULT NULL');
    addColumnToTableIfNotExists(db, 'projects', columnNames, 'isStarred', 'BOOLEAN DEFAULT 0');
    addColumnToTableIfNotExists(db, 'projects', columnNames, 'isArchived', 'BOOLEAN DEFAULT 0');
    db.exec(`
      UPDATE projects
      SET project_id = ${SQLITE_UUID_SQL}
      WHERE project_id IS NULL OR trim(project_id) = ''
    `);
    return;
  }

  console.log('Running migration: Rebuilding projects table to enforce project_id primary key');

  const projectPathExpression = columnNames.includes('project_path')
    ? 'project_path'
    : columnNames.includes('workspace_path')
      ? 'workspace_path'
      : 'NULL';

  const customProjectNameExpression = columnNames.includes('custom_project_name')
    ? 'custom_project_name'
    : columnNames.includes('custom_workspace_name')
      ? 'custom_workspace_name'
      : 'NULL';

  const isStarredExpression = columnNames.includes('isStarred') ? 'COALESCE(isStarred, 0)' : '0';

  const isArchivedExpression = columnNames.includes('isArchived') ? 'COALESCE(isArchived, 0)' : '0';

  const projectIdExpression = columnNames.includes('project_id')
    ? `CASE
         WHEN project_id IS NULL OR trim(project_id) = ''
         THEN ${SQLITE_UUID_SQL}
         ELSE project_id
       END`
    : SQLITE_UUID_SQL;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN TRANSACTION');
    db.exec('DROP TABLE IF EXISTS projects__new');
    db.exec(`
      CREATE TABLE projects__new (
        project_id TEXT PRIMARY KEY NOT NULL,
        project_path TEXT NOT NULL UNIQUE,
        custom_project_name TEXT DEFAULT NULL,
        isStarred BOOLEAN DEFAULT 0,
        isArchived BOOLEAN DEFAULT 0
      )
    `);
    db.exec(`
      WITH source_rows AS (
        SELECT
          ${projectPathExpression} AS project_path,
          ${customProjectNameExpression} AS custom_project_name,
          ${isStarredExpression} AS isStarred,
          ${isArchivedExpression} AS isArchived,
          ${projectIdExpression} AS candidate_project_id,
          rowid AS source_rowid
        FROM projects
        WHERE ${projectPathExpression} IS NOT NULL AND trim(${projectPathExpression}) <> ''
      ),
      deduped_paths AS (
        SELECT
          project_path,
          custom_project_name,
          isStarred,
          isArchived,
          candidate_project_id,
          source_rowid,
          ROW_NUMBER() OVER (PARTITION BY project_path ORDER BY source_rowid) AS project_path_rank
        FROM source_rows
      ),
      prepared_rows AS (
        SELECT
          CASE
            WHEN ROW_NUMBER() OVER (PARTITION BY candidate_project_id ORDER BY source_rowid) = 1
            THEN candidate_project_id
            ELSE ${SQLITE_UUID_SQL}
          END AS project_id,
          project_path,
          custom_project_name,
          isStarred,
          isArchived
        FROM deduped_paths
        WHERE project_path_rank = 1
      )
      INSERT INTO projects__new (
        project_id,
        project_path,
        custom_project_name,
        isStarred,
        isArchived
      )
      SELECT
        project_id,
        project_path,
        custom_project_name,
        isStarred,
        isArchived
      FROM prepared_rows
    `);
    db.exec('DROP TABLE projects');
    db.exec('ALTER TABLE projects__new RENAME TO projects');
    db.exec('COMMIT');
  } catch (migrationError) {
    db.exec('ROLLBACK');
    throw migrationError;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};

const rebuildSessionsTableWithProjectSchema = (db: Database): void => {
  const hasSessions = tableExists(db, 'sessions');
  if (!hasSessions) {
    db.exec(SESSIONS_TABLE_SCHEMA_SQL);
    return;
  }

  const sessionsTableInfo = getTableInfo(db, 'sessions');
  const columnNames = sessionsTableInfo.map((column) => column.name);
  const primaryKeyColumns = sessionsTableInfo
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);

  const shouldRebuild =
    !columnNames.includes('project_path') ||
    primaryKeyColumns.length !== 1 ||
    primaryKeyColumns[0] !== 'session_id' ||
    !columnNames.includes('provider');

  if (!shouldRebuild) {
    addColumnToTableIfNotExists(db, 'sessions', columnNames, 'jsonl_path', 'TEXT');
    addColumnToTableIfNotExists(db, 'sessions', columnNames, 'isArchived', 'BOOLEAN DEFAULT 0');
    addColumnToTableIfNotExists(db, 'sessions', columnNames, 'created_at', 'DATETIME');
    addColumnToTableIfNotExists(db, 'sessions', columnNames, 'updated_at', 'DATETIME');
    db.exec('UPDATE sessions SET isArchived = COALESCE(isArchived, 0)');
    db.exec('UPDATE sessions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP)');
    db.exec('UPDATE sessions SET updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)');
    return;
  }

  console.log('Running migration: Rebuilding sessions table to project-based schema');

  const projectPathExpression = columnNames.includes('project_path')
    ? 'project_path'
    : columnNames.includes('workspace_path')
      ? 'workspace_path'
      : 'NULL';

  const providerExpression = columnNames.includes('provider')
    ? "COALESCE(provider, 'claude')"
    : "'claude'";

  const customNameExpression = columnNames.includes('custom_name')
    ? 'custom_name'
    : 'NULL';

  const jsonlPathExpression = columnNames.includes('jsonl_path')
    ? 'jsonl_path'
    : 'NULL';

  const isArchivedExpression = columnNames.includes('isArchived')
    ? 'COALESCE(isArchived, 0)'
    : '0';

  const createdAtExpression = columnNames.includes('created_at')
    ? 'COALESCE(created_at, CURRENT_TIMESTAMP)'
    : 'CURRENT_TIMESTAMP';

  const updatedAtExpression = columnNames.includes('updated_at')
    ? 'COALESCE(updated_at, CURRENT_TIMESTAMP)'
    : 'CURRENT_TIMESTAMP';

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN TRANSACTION');
    db.exec('DROP TABLE IF EXISTS sessions__new');
    db.exec(`
      CREATE TABLE sessions__new (
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        custom_name TEXT,
        project_path TEXT,
        jsonl_path TEXT,
        isArchived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id),
        FOREIGN KEY (project_path) REFERENCES projects(project_path)
        ON DELETE SET NULL
        ON UPDATE CASCADE
      )
    `);
    db.exec(`
      WITH source_rows AS (
        SELECT
          session_id,
          ${providerExpression} AS provider,
          ${customNameExpression} AS custom_name,
          ${projectPathExpression} AS project_path,
          ${jsonlPathExpression} AS jsonl_path,
          ${isArchivedExpression} AS isArchived,
          ${createdAtExpression} AS created_at,
          ${updatedAtExpression} AS updated_at,
          rowid AS source_rowid
        FROM sessions
        WHERE session_id IS NOT NULL AND trim(session_id) <> ''
      ),
      ranked_rows AS (
        SELECT
          session_id,
          provider,
          custom_name,
          project_path,
          jsonl_path,
          isArchived,
          created_at,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY session_id
            ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, source_rowid DESC
          ) AS session_rank
        FROM source_rows
      )
      INSERT INTO sessions__new (
        session_id,
        provider,
        custom_name,
        project_path,
        jsonl_path,
        isArchived,
        created_at,
        updated_at
      )
      SELECT
        session_id,
        provider,
        custom_name,
        project_path,
        jsonl_path,
        isArchived,
        created_at,
        updated_at
      FROM ranked_rows
      WHERE session_rank = 1
    `);
    db.exec('DROP TABLE sessions');
    db.exec('ALTER TABLE sessions__new RENAME TO sessions');
    db.exec('COMMIT');
  } catch (migrationError) {
    db.exec('ROLLBACK');
    throw migrationError;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};

/**
 * Adds the `provider_session_id` mapping column used by the session gateway.
 *
 * Rows that existed before this migration were always keyed directly by the
 * provider-native session id, so backfilling `provider_session_id` with
 * `session_id` keeps every legacy row resolvable through the new mapping.
 */
const addProviderSessionIdMapping = (db: Database): void => {
  const sessionsTableInfo = getTableInfo(db, 'sessions');
  const columnNames = sessionsTableInfo.map((column) => column.name);

  addColumnToTableIfNotExists(db, 'sessions', columnNames, 'provider_session_id', 'TEXT');
  db.exec(`
    UPDATE sessions
    SET provider_session_id = session_id
    WHERE provider_session_id IS NULL
  `);
};

/**
 * Adds the nullable `profile_id` column that links a session to the account
 * profile whose isolated config directory served it.
 *
 * Existing rows predate the multi-account feature and stay NULL, which keeps
 * them running against the provider CLI's default config directory exactly as
 * before. New rows get their owning profile stamped by the session gateway and
 * the provider synchronizers.
 */
const addProfileIdToSessions = (db: Database): void => {
  const sessionsTableInfo = getTableInfo(db, 'sessions');
  const columnNames = sessionsTableInfo.map((column) => column.name);

  addColumnToTableIfNotExists(db, 'sessions', columnNames, 'profile_id', 'TEXT');
};

/**
 * Adds the nullable per-session override of the response-compression level.
 *
 * NULL keeps a session following whatever its profile is set to, so existing
 * sessions inherit the profile default instead of being pinned to whatever the
 * level happened to be when this column was added.
 */
const addCavemanModeToSessions = (db: Database): void => {
  const columnNames = getTableInfo(db, 'sessions').map((column) => column.name);

  addColumnToTableIfNotExists(db, 'sessions', columnNames, 'caveman_mode', 'TEXT');
};

/**
 * Adds the nullable `seed_primer_path` column used by mid-session provider
 * handoffs to stash a one-shot "context primer" file on the freshly created
 * session row. The session's next turn reads the file, prefixes its content
 * to the outgoing prompt, then clears the column back to NULL.
 *
 * Existing rows predate the handoff feature and stay NULL, which is exactly
 * the "no primer pending" state.
 */
const addSeedPrimerPathToSessions = (db: Database): void => {
  const columnNames = getTableInfo(db, 'sessions').map((column) => column.name);

  addColumnToTableIfNotExists(db, 'sessions', columnNames, 'seed_primer_path', 'TEXT');
};

/**
 * Adds worktree execution context to sessions.
 *
 * worktree_path stores the absolute path to the worktree where the session
 * executes. NULL means the session runs at the project root (standard behavior).
 *
 * worktree_branch stores the branch label displayed in the session list as a
 * badge, refreshed on each sync. NULL when worktree_path is NULL.
 *
 * Existing sessions stay NULL for both columns, preserving their standard
 * repository root execution.
 */
const addWorktreeColumnsToSessions = (db: Database): void => {
  const columnNames = getTableInfo(db, 'sessions').map((column) => column.name);

  addColumnToTableIfNotExists(db, 'sessions', columnNames, 'worktree_path', 'TEXT');
  addColumnToTableIfNotExists(db, 'sessions', columnNames, 'worktree_branch', 'TEXT');
};

/**
 * Adds the per-profile agent tooling defaults.
 *
 * Both stay NULL for profiles that predate the feature, which resolves to off
 * for each — enabling either one for an existing account is an explicit act,
 * never something a migration turns on underneath the user.
 *
 * Must run after the profiles table itself is created.
 */
const addAgentToolingColumnsToProfiles = (db: Database): void => {
  if (!tableExists(db, 'profiles')) {
    return;
  }
  const columnNames = getTableInfo(db, 'profiles').map((column) => column.name);

  addColumnToTableIfNotExists(db, 'profiles', columnNames, 'caveman_mode', 'TEXT');
  addColumnToTableIfNotExists(db, 'profiles', columnNames, 'rtk_mode', 'TEXT');
};

/**
 * Adds the fallback-account flag.
 *
 * Every existing profile starts at 0: promoting one is an explicit act, and
 * guessing here would silently rebind new sessions of an account the user
 * never nominated.
 *
 * Must run after the profiles table itself is created.
 */
const addDefaultFlagToProfiles = (db: Database): void => {
  if (!tableExists(db, 'profiles')) {
    return;
  }
  const columnNames = getTableInfo(db, 'profiles').map((column) => column.name);

  addColumnToTableIfNotExists(db, 'profiles', columnNames, 'is_default', 'INTEGER NOT NULL DEFAULT 0');
};

const ensureProjectsForSessionPaths = (db: Database): void => {
  if (!tableExists(db, 'sessions')) {
    return;
  }

  db.exec(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived)
    SELECT
      ${SQLITE_UUID_SQL},
      project_path,
      NULL,
      0,
      0
    FROM sessions
    WHERE project_path IS NOT NULL AND trim(project_path) <> ''
    ON CONFLICT(project_path) DO NOTHING
  `);
};

/**
 * Gives every pre-existing session with a resolved provider_session_id its
 * seq = 0 leg, mirroring the columns sessions already denormalizes as the
 * "active leg" projection. After this, "session with zero legs" only happens
 * for sessions that never got a provider_session_id (app-created, never run).
 *
 * started_at is backdated to the session's own created_at rather than left at
 * its CURRENT_TIMESTAMP default, since the leg genuinely started then.
 *
 * The NOT EXISTS guard makes this idempotent: a session that already has a
 * leg (backfilled on a prior run, or opened by the app since) is skipped.
 */
const backfillSessionLegs = (db: Database): void => {
  if (!tableExists(db, 'sessions') || !tableExists(db, 'session_legs')) {
    return;
  }

  db.exec(`
    INSERT INTO session_legs (
      leg_id, session_id, seq, provider, profile_id,
      provider_session_id, jsonl_path, started_at
    )
    SELECT
      ${SQLITE_UUID_SQL},
      sessions.session_id,
      0,
      sessions.provider,
      sessions.profile_id,
      sessions.provider_session_id,
      sessions.jsonl_path,
      sessions.created_at
    FROM sessions
    WHERE sessions.provider_session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM session_legs WHERE session_legs.session_id = sessions.session_id
      )
  `);
};

/**
 * How far apart a source session's last activity may sit from the target's
 * creation and still be accepted as the same handoff. Generous because the old
 * handoff could be triggered long after the source's last turn, bounded because
 * beyond a few days "the most recent session on that provider" stops being
 * evidence of anything.
 */
const FORKED_HANDOFF_MATCH_WINDOW_HOURS = 72;

/** Mirrors the header `buildHandoffPrimer` writes at the top of every primer. */
const FORKED_HANDOFF_ORIGIN_PATTERN =
  /^This conversation started in another session, on provider `([^`]+)`(?: \(account "([^"]+)"\))?\.$/m;

type ForkedHandoffTargetRow = {
  session_id: string;
  created_at: string | null;
  seed_primer_path: string;
};

type ForkedHandoffCandidateRow = {
  session_id: string;
  gap_hours: number;
};

const parseForkedHandoffOrigin = (
  primerText: string,
): { provider: string; accountName: string | null } | null => {
  const match = FORKED_HANDOFF_ORIGIN_PATTERN.exec(primerText);
  if (!match) {
    return null;
  }

  return { provider: match[1], accountName: match[2] ?? null };
};

/**
 * Merges the target sessions of pre-legs cross-provider handoffs back under
 * the source session they were forked from.
 *
 * The old handoff created a brand-new session row pointing at a primer file and
 * never mutated (or referenced) the source, so no column links the pair: the
 * only surviving evidence is the provider and account name the primer's header
 * names. Merging the wrong pair would file a conversation under an unrelated
 * session and is unrecoverable, while leaving a legacy pair as two sessions is
 * merely the status quo — so anything short of a single unambiguous match is
 * skipped and logged instead of guessed.
 *
 * Migrating removes the target row, so a second run finds nothing left to do.
 */
const mergeForkedHandoffPairsIntoLegs = (db: Database): void => {
  if (!tableExists(db, 'sessions') || !tableExists(db, 'session_legs') || !tableExists(db, 'profiles')) {
    return;
  }
  if (!getTableInfo(db, 'sessions').some((column) => column.name === 'seed_primer_path')) {
    return;
  }

  const targets = db
    .prepare(
      `SELECT session_id, created_at, seed_primer_path
       FROM sessions
       WHERE seed_primer_path IS NOT NULL`
    )
    .all() as ForkedHandoffTargetRow[];

  for (const target of targets) {
    const skip = (reason: string): void => {
      console.warn(`Skipping forked handoff pair for session ${target.session_id}: ${reason}`);
    };

    try {
      let primerText: string;
      try {
        primerText = readFileSync(target.seed_primer_path, 'utf8');
      } catch (readError) {
        const message = readError instanceof Error ? readError.message : String(readError);
        skip(`primer file unreadable (${message})`);
        continue;
      }

      const origin = parseForkedHandoffOrigin(primerText);
      if (!origin) {
        skip('primer header does not name an origin provider');
        continue;
      }

      const candidates = db
        .prepare(
          `SELECT
             sessions.session_id AS session_id,
             (julianday(?) - julianday(COALESCE(sessions.updated_at, sessions.created_at))) * 24 AS gap_hours
           FROM sessions
           LEFT JOIN profiles ON profiles.id = sessions.profile_id
           WHERE sessions.session_id <> ?
             AND sessions.provider = ?
             AND (? IS NULL OR profiles.name = ?)
             AND julianday(COALESCE(sessions.updated_at, sessions.created_at))
                 <= julianday(?)
           ORDER BY gap_hours ASC`
        )
        .all(
          target.created_at,
          target.session_id,
          origin.provider,
          origin.accountName,
          origin.accountName,
          target.created_at,
        ) as ForkedHandoffCandidateRow[];

      if (candidates.length === 0) {
        skip('no candidate source session matched the primer origin');
        continue;
      }
      if (candidates.length > 1) {
        skip(`ambiguous origin: ${candidates.length} candidate source sessions matched`);
        continue;
      }

      const candidate = candidates[0];
      if (candidate.gap_hours > FORKED_HANDOFF_MATCH_WINDOW_HOURS) {
        skip(
          `only candidate ${candidate.session_id} is outside the ${FORKED_HANDOFF_MATCH_WINDOW_HOURS}h window`,
        );
        continue;
      }

      const targetLegCount = (
        db
          .prepare('SELECT COUNT(*) AS total FROM session_legs WHERE session_id = ?')
          .get(target.session_id) as { total: number }
      ).total;
      if (targetLegCount !== 1) {
        skip(`target has ${targetLegCount} legs, expected exactly the backfilled one`);
        continue;
      }

      const merge = db.transaction(() => {
        const nextSeqRow = db
          .prepare('SELECT MAX(seq) AS maxSeq FROM session_legs WHERE session_id = ?')
          .get(candidate.session_id) as { maxSeq: number | null };
        const nextSeq = (nextSeqRow.maxSeq ?? -1) + 1;

        db.prepare('UPDATE session_legs SET session_id = ?, seq = ? WHERE session_id = ?').run(
          candidate.session_id,
          nextSeq,
          target.session_id,
        );
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(target.session_id);
      });
      merge();

      console.log(
        `Running migration: merged forked handoff session ${target.session_id} into ${candidate.session_id} as a leg`,
      );
    } catch (mergeError) {
      const message = mergeError instanceof Error ? mergeError.message : String(mergeError);
      skip(`unexpected failure (${message})`);
    }
  }
};

export const runMigrations = (db: Database) => {
  try {
    const usersTableInfo = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    const userColumnNames = usersTableInfo.map((column) => column.name);

    addColumnToTableIfNotExists(db, 'users', userColumnNames, 'git_name', 'TEXT');
    addColumnToTableIfNotExists(db, 'users', userColumnNames, 'git_email', 'TEXT');
    addColumnToTableIfNotExists(
      db,
      'users',
      userColumnNames,
      'has_completed_onboarding',
      'BOOLEAN DEFAULT 0'
    );

    db.exec(APP_CONFIG_TABLE_SCHEMA_SQL);
    db.exec(USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL);
    db.exec(VAPID_KEYS_TABLE_SCHEMA_SQL);
    db.exec(PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id)');
    db.exec(NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_user_channel ON notification_channel_endpoints(user_id, channel)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_enabled ON notification_channel_endpoints(enabled)');

    db.exec(PROJECTS_TABLE_SCHEMA_SQL);
    rebuildProjectsTableWithPrimaryKeySchema(db);

    migrateLegacyWorkspaceTableIntoProjects(db);
    rebuildSessionsTableWithProjectSchema(db);
    migrateLegacySessionNames(db);
    addProviderSessionIdMapping(db);
    addProfileIdToSessions(db);
    addCavemanModeToSessions(db);
    addSeedPrimerPathToSessions(db);
    ensureProjectsForSessionPaths(db);

    db.exec(PROFILES_TABLE_SCHEMA_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_provider ON profiles(provider)');
    addAgentToolingColumnsToProfiles(db);
    addDefaultFlagToProfiles(db);
    // "At most one default per provider" is a data rule, so the database holds
    // it: a second promotion racing the first fails loudly instead of leaving
    // two candidates and a lookup that picks arbitrarily.
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_default_per_provider
      ON profiles(provider) WHERE is_default = 1
    `);

    db.exec(COLLABORATIONS_TABLE_SCHEMA_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_collaborations_project ON collaborations(project_path)');
    db.exec(COLLABORATION_TURNS_TABLE_SCHEMA_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_collaboration_turns_collab ON collaboration_turns(collaboration_id)');

    addWorktreeColumnsToSessions(db);

    db.exec(SESSION_LEGS_TABLE_SCHEMA_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_session_legs_session ON session_legs(session_id, seq)');
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_legs_provider_session
      ON session_legs(provider_session_id) WHERE provider_session_id IS NOT NULL
    `);
    backfillSessionLegs(db);
    mergeForkedHandoffPairsIntoLegs(db);

    db.exec('CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_provider_session_id ON sessions(provider_session_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_is_archived ON sessions(isArchived)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_projects_is_starred ON projects(isStarred)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_projects_is_archived ON projects(isArchived)');

    db.exec('DROP INDEX IF EXISTS idx_session_names_lookup');
    db.exec('DROP INDEX IF EXISTS idx_sessions_workspace_path');
    db.exec('DROP INDEX IF EXISTS idx_workspace_original_paths_is_starred');
    db.exec('DROP INDEX IF EXISTS idx_workspace_original_paths_workspace_id');

    if (tableExists(db, 'workspace_original_paths')) {
      console.log('Running migration: Dropping legacy workspace_original_paths table');
      db.exec('DROP TABLE workspace_original_paths');
    }

    db.exec(SESSION_RUN_FAILURES_TABLE_SCHEMA_SQL);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_session_run_failures_session
      ON session_run_failures(session_id, failed_at)
    `);

    db.exec(LAST_SCANNED_AT_SQL);
    console.log('Database migrations completed successfully');
  } catch (error: any) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};
