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
    -- Marks the account a new session of this provider falls back to when the
    -- user picked none. At most one row per provider may carry it, enforced by
    -- a partial unique index rather than by application code alone.
    is_default INTEGER NOT NULL DEFAULT 0,
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
    -- JSON {totalTokens, maxTurns, turnTimeoutMs}: the ceiling this run may
    -- spend. NULL means the defaults derived from the run's own shape, which is
    -- what every collaboration written before budgets existed carries.
    budget TEXT,
    -- JSON council summary computed from the stored contracts when the run
    -- ends. NULL while it is still running, and for runs that ended before a
    -- summary could be written.
    summary TEXT,
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
    -- JSON council contract {evidence, risks, tests, disagreements, confidence}
    -- parsed out of the content column. NULL when the turn carried none, which
    -- is the normal state for every mode that does not ask for one.
    contract TEXT,
    -- Why the contract could not be read in full. The raw answer always stays
    -- in the content column, so a malformed turn is displayable, never lost.
    contract_error TEXT,
    -- Tokens this turn actually cost, when the provider adapter reports them.
    -- NULL means "not reported", which is not the same as zero.
    input_tokens INTEGER,
    output_tokens INTEGER,
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

export const ACTIVE_SESSION_RUNS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS active_session_runs (
    -- One row per session: a session can only have one run in flight at a time.
    session_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    -- ISO timestamp, written when the run starts. The boot sweep compares it
    -- against the session's recorded failures to tell a run that was already
    -- explained (a graceful shutdown wrote its row) from one that was not.
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

export const ORGS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    -- Catch-all org that every project resolves to when no rule matches.
    -- Enforced as at most one row via a partial unique index in migrations,
    -- the same pattern as profiles.is_default per provider.
    is_default INTEGER NOT NULL DEFAULT 0,
    -- Usage percentage (of the primary profile's quota) above which the
    -- policy resolver may consider a fallback profile eligible.
    fallback_threshold INTEGER NOT NULL DEFAULT 85,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const ORG_PROJECT_RULES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS org_project_rules (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('path_prefix', 'project_name')),
    pattern TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
`;

export const ORG_PROFILE_POLICIES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS org_profile_policies (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('primary', 'fallback')),
    priority INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- A profile can only hold one policy row per org, so the resolver never
    -- has to choose between two conflicting roles/priorities for the same pair.
    UNIQUE(org_id, profile_id),
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
`;

export const TASKS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    project_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    stage TEXT NOT NULL DEFAULT 'backlog'
      CHECK (stage IN ('backlog', 'in_progress', 'review', 'done')),
    origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'agent', 'automation')),
    origin_detail TEXT,
    assignee_profile_id TEXT,
    suggested_skill TEXT,
    worktree_branch TEXT,
    -- Set on a subtask: the task it was broken out of. Deleting the parent
    -- takes its subtasks with it, because a subtask has no meaning on its own
    -- (the board only ever shows it under the work it decomposes).
    parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assignee_profile_id) REFERENCES profiles(id) ON DELETE SET NULL
);
`;

/**
 * Ordering constraints between tasks: `task_id` cannot start before
 * `depends_on_task_id` is done.
 *
 * The pair is the primary key, so declaring the same edge twice is a no-op
 * rather than a duplicate that would have to be de-duplicated on every read,
 * and the CHECK stops a task from depending on itself — an edge that could
 * never be satisfied and would silently park the task forever.
 */
export const TASK_DEPENDENCIES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id <> depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
`;

export const TASK_ATTACHMENTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS task_attachments (
    attachment_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    stored_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
`;

export const TASK_EVIDENCE_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS task_evidence (
    evidence_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'link', 'attachment')),
    content TEXT NOT NULL,
    -- Set only when kind = 'attachment'; points at the file this evidence
    -- entry documents. ON DELETE SET NULL rather than CASCADE: deleting the
    -- attached file should not erase the evidence trail that references it.
    attachment_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (attachment_id) REFERENCES task_attachments(attachment_id) ON DELETE SET NULL
);
`;

export const PROFILE_FALLBACK_AUDIT_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profile_fallback_audit (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    session_id TEXT,
    reason TEXT NOT NULL,
    primary_usage_pct INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
`;

export const AUTOMATIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS automations (
    automation_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    trigger_kind TEXT NOT NULL
      CHECK (trigger_kind IN ('cron', 'task_stage', 'webhook', 'quota_threshold')),
    -- Trigger and action parameters are JSON documents rather than columns:
    -- each kind carries a different shape, and the service validates them on
    -- the way in so nothing unparseable is ever stored.
    trigger_config TEXT NOT NULL DEFAULT '{}',
    action_kind TEXT NOT NULL
      CHECK (action_kind IN ('prompt_agent', 'create_task', 'notify_push')),
    action_config TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * Agent-to-agent handoff inbox.
 *
 * `from_session_id`/`to_session_id` are soft references to `sessions`: the
 * handoff trail is the record of who asked whom for what, and it has to keep
 * reading correctly after either session is deleted, so no cascade erases it.
 * `detail` carries the reason a message ended in `failed` (and nothing else),
 * which is what a stuck maestro gets to read instead of a bare state.
 */
export const AGENT_MESSAGES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_messages (
    message_id TEXT PRIMARY KEY NOT NULL,
    from_session_id TEXT NOT NULL,
    to_session_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued'
      CHECK (state IN ('queued', 'delivered', 'acknowledged', 'answered', 'failed')),
    -- Set on a reply so the answer and the question read as one thread. The
    -- referenced message is never removed by this module, so a plain soft
    -- reference is enough and keeps the reply readable on its own.
    reply_to_message_id TEXT,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const AUTOMATION_RUNS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS automation_runs (
    run_id TEXT PRIMARY KEY NOT NULL,
    automation_id TEXT NOT NULL,
    fired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
    detail TEXT,
    -- 1-based; one row per attempt, so a firing that only succeeded on its
    -- third try leaves the two failures behind it in the history.
    attempt INTEGER NOT NULL DEFAULT 1,
    -- Identifies the event that caused the firing (a task's stage transition, a
    -- cron minute, ...). NULL means "always fire" — manual test fires and
    -- webhooks without an idempotency key. The unique index below is what makes
    -- the same event unable to fire the same automation twice.
    dedupe_key TEXT,
    FOREIGN KEY (automation_id) REFERENCES automations(automation_id) ON DELETE CASCADE
);
`;

export const TASK_REVIEWS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS task_reviews (
    review_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    -- 'open' and 'changes_requested' are both live states: the card is still
    -- waiting on a human. 'approved' and 'closed' are terminal and drop the
    -- review out of the queue.
    state TEXT NOT NULL DEFAULT 'open'
      CHECK (state IN ('open', 'approved', 'changes_requested', 'closed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
`;

export const REVIEW_COMMENTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS review_comments (
    comment_id TEXT PRIMARY KEY NOT NULL,
    review_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    -- NULL means the comment is about the file as a whole (or about the whole
    -- review, when file_path is the empty string) rather than about one line.
    line_no INTEGER,
    body TEXT NOT NULL,
    author TEXT NOT NULL CHECK (author IN ('user', 'agent')),
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (review_id) REFERENCES task_reviews(review_id) ON DELETE CASCADE
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

${ACTIVE_SESSION_RUNS_TABLE_SCHEMA_SQL}
${LAST_SCANNED_AT_SQL}

${APP_CONFIG_TABLE_SCHEMA_SQL}

${ORGS_TABLE_SCHEMA_SQL}
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_default ON orgs(is_default) WHERE is_default = 1;

${ORG_PROJECT_RULES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_org_project_rules_org ON org_project_rules(org_id);

${ORG_PROFILE_POLICIES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_org_profile_policies_org ON org_profile_policies(org_id);

${TASKS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_tasks_project_stage ON tasks(project_name, stage);

${TASK_ATTACHMENTS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

${TASK_EVIDENCE_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_task_evidence_task ON task_evidence(task_id);

${PROFILE_FALLBACK_AUDIT_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_profile_fallback_audit_org ON profile_fallback_audit(org_id, created_at);

${AUTOMATIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations(trigger_kind, enabled);

${AUTOMATION_RUNS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, fired_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_dedupe
  ON automation_runs(automation_id, dedupe_key, attempt) WHERE dedupe_key IS NOT NULL;

${AGENT_MESSAGES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_agent_messages_inbox ON agent_messages(to_session_id, state);
CREATE INDEX IF NOT EXISTS idx_agent_messages_outbox ON agent_messages(from_session_id, state);

${TASK_REVIEWS_TABLE_SCHEMA_SQL}
-- A task has at most one live review: re-entering the Review column reuses the
-- existing thread instead of forking the comments across duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_reviews_live
  ON task_reviews(task_id) WHERE state IN ('open', 'changes_requested');
CREATE INDEX IF NOT EXISTS idx_task_reviews_state ON task_reviews(state, updated_at);

${REVIEW_COMMENTS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_review_comments_review ON review_comments(review_id, file_path);

${TASK_DEPENDENCIES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
`;
