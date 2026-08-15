const USER_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 0
);
`;

export const API_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_CREDENTIALS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const VAPID_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS vapid_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notification_channel_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    label TEXT,
    metadata_json TEXT,
    enabled BOOLEAN DEFAULT 1,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, channel, endpoint_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const PROJECTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    project_path TEXT NOT NULL UNIQUE,
    custom_project_name TEXT DEFAULT NULL,
    isStarred BOOLEAN DEFAULT 0,
    isArchived BOOLEAN DEFAULT 0
);
`;

export const PROFILES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Default response-compression level for sessions of this profile, which a
    -- session may override. NULL means "never configured" and resolves to off.
    caveman_mode TEXT,
    -- Command-rewriting level for this profile. Unlike caveman_mode this is not
    -- overridable per session: it is installed as a hook in the profile's own
    -- settings.json, which every session of the profile shares.
    rtk_mode TEXT,
    -- One isolated on-disk config directory per (provider, slug). The unique
    -- constraint guarantees two profiles of the same provider can never resolve
    -- to the same credential directory, which is what keeps their accounts
    -- isolated from one another.
    UNIQUE(provider, slug)
);
`;

export const SESSIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    -- The session id used by the provider CLI/SDK on disk (JSONL file name,
    -- store.db folder, sqlite row id, ...). \`session_id\` is the stable
    -- app-facing id that the frontend uses for the whole session lifetime;
    -- \`provider_session_id\` is filled in once the provider announces its own
    -- id mid-run, or equals \`session_id\` for sessions discovered on disk.
    provider_session_id TEXT,
    custom_name TEXT,
    project_path TEXT,
    jsonl_path TEXT,
    -- Account profile that owns this session, or NULL for sessions that predate
    -- the multi-account feature (they keep the provider CLI's default config
    -- directory). Kept as a soft reference (no SQL foreign key) so that
    -- referential rules — e.g. refusing to delete a profile with live sessions —
    -- live in the profiles service rather than in cascade triggers.
    profile_id TEXT,
    -- Per-session override of the profile's response-compression level. NULL
    -- means "follow the profile", which is what keeps a profile-level change
    -- visible to sessions that never expressed an opinion of their own.
    caveman_mode TEXT,
    -- Absolute path to the worktree where this session executes. NULL means
    -- the session runs at the project root (standard repository behavior).
    worktree_path TEXT,
    -- Label of the worktree branch, refreshed on each sync. Displayed as a badge
    -- in the session list when worktree_path is present. NULL when worktree_path
    -- is NULL.
    worktree_branch TEXT,
    -- Absolute path to a one-shot "context primer" file stashed on this
    -- session by a mid-session provider handoff. The session's next turn
    -- reads the file, prefixes its content to the outgoing prompt, then
    -- clears this column back to NULL. NULL means no primer is pending.
    seed_primer_path TEXT,
    isArchived BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id),
    FOREIGN KEY (project_path) REFERENCES projects(project_path)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);
`;

export const COLLABORATIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS collaborations (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    -- debate | review | vote. Free-form TEXT because the accepted set belongs to
    -- the request validator, not to a constraint that a migration would fight.
    mode TEXT NOT NULL,
    project_path TEXT NOT NULL,
    -- running | converged | exhausted | stopped | failed
    status TEXT NOT NULL,
    max_rounds INTEGER NOT NULL,
    current_round INTEGER NOT NULL DEFAULT 0,
    -- JSON array of {profileId, provider, role}. The list is short, always read
    -- whole and never queried per participant, so a child table would be
    -- ceremony. Participant profile ids are soft references like
    -- sessions.profile_id: deleting a profile must not erase run history.
    participants TEXT NOT NULL,
    -- Final synthesis; NULL while the collaboration is still running.
    verdict TEXT,
    -- Reason shown to the user when status = failed.
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const COLLABORATION_TURNS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS collaboration_turns (
    id TEXT PRIMARY KEY,
    collaboration_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    -- Order inside the round. Several turns can land in the same one-second
    -- SQLite tick, so created_at alone cannot order a transcript.
    turn_index INTEGER NOT NULL,
    profile_id TEXT NOT NULL,
    -- participant | arbiter
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    -- 1 yes, 0 no, NULL when the turn does not vote (arbiter, or a model that
    -- ignored the required output format).
    consensus INTEGER,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (collaboration_id) REFERENCES collaborations(id) ON DELETE CASCADE
);
`;

export const SESSION_LEGS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_legs (
    leg_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    provider TEXT NOT NULL,
    profile_id TEXT,
    -- NULL until the provider CLI announces its native session id on the
    -- leg's first turn.
    provider_session_id TEXT,
    jsonl_path TEXT,
    -- Account name at the moment of the switch. The profile can be removed
    -- later and the boundary marker still needs to say who answered.
    profile_name_at_switch TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT
);
`;

export const SESSION_RUN_FAILURES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_run_failures (
    failure_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    -- Why the run died, as the runtime reported it ("session limit reached",
    -- "not logged in", a SIGKILL notice). Live error events reach the client
    -- over the websocket only, so without this row a failure that lands while
    -- the tab is closed leaves no trace anywhere and the session just looks
    -- stopped.
    error_message TEXT NOT NULL,
    exit_code INTEGER,
    failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export const LAST_SCANNED_AT_SQL = `
CREATE TABLE IF NOT EXISTS scan_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_scanned_at TIMESTAMP NULL
);
`;

export const APP_CONFIG_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const INIT_SCHEMA_SQL = `
-- Initialize authentication database
PRAGMA foreign_keys = ON;

${USER_TABLE_SCHEMA_SQL}
-- Indexes for performance for user lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

${API_KEYS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

${USER_CREDENTIALS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

${USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id);

${VAPID_KEYS_TABLE_SCHEMA_SQL}

${PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

${NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_user_channel ON notification_channel_endpoints(user_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_enabled ON notification_channel_endpoints(enabled);

${PROJECTS_TABLE_SCHEMA_SQL}
-- NOTE: These indexes are created in migrations after legacy table-shape repairs.
-- Creating them here can fail on upgraded installs where projects lacks those columns.

${PROFILES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_profiles_provider ON profiles(provider);

${SESSIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id);
-- NOTE: This index is created in migrations after sessions is rebuilt to include project_path.
-- Creating it here can fail on upgraded installs where the legacy sessions table has no project_path.

${SESSION_LEGS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_session_legs_session ON session_legs(session_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_legs_provider_session
  ON session_legs(provider_session_id) WHERE provider_session_id IS NOT NULL;

${COLLABORATIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_collaborations_project ON collaborations(project_path);

${COLLABORATION_TURNS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_collaboration_turns_collab ON collaboration_turns(collaboration_id);

${SESSION_RUN_FAILURES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_session_run_failures_session
  ON session_run_failures(session_id, failed_at);

${LAST_SCANNED_AT_SQL}

${APP_CONFIG_TABLE_SCHEMA_SQL}
`;
