import { getConnection } from '@/modules/database/connection.js';

export type LegRow = {
  leg_id: string;
  session_id: string;
  seq: number;
  provider: string;
  profile_id: string | null;
  provider_session_id: string | null;
  jsonl_path: string | null;
  profile_name_at_switch: string | null;
  started_at: string;
  ended_at: string | null;
};

const LEG_ROW_COLUMNS =
  'leg_id, session_id, seq, provider, profile_id, provider_session_id, jsonl_path, profile_name_at_switch, started_at, ended_at';

// Matches the UUID expression used elsewhere in this codebase (see
// migrations.ts's SQLITE_UUID_SQL) so leg ids look identical to every other
// SQLite-generated id in the database.
const SQLITE_UUID_SQL = `
lower(hex(randomblob(4))) || '-' ||
lower(hex(randomblob(2))) || '-' ||
lower(hex(randomblob(2))) || '-' ||
lower(hex(randomblob(2))) || '-' ||
lower(hex(randomblob(6)))
`;

export type OpenLegInput = {
  sessionId: string;
  provider: string;
  profileId: string | null;
  profileNameAtSwitch: string | null;
};

export const sessionLegsDb = {
  listLegs(sessionId: string): LegRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${LEG_ROW_COLUMNS}
         FROM session_legs
         WHERE session_id = ?
         ORDER BY seq ASC`
      )
      .all(sessionId) as LegRow[];
  },

  /**
   * `profile_id` can be NULL (profile deleted, or the leg was never assigned
   * one), so it must be matched with `IS`, not `=` — `=` never matches NULL
   * against NULL in SQL and would make every no-profile leg unfindable.
   *
   * More than one leg can match (a degraded-transcript leg leaves its row
   * behind when a switch falls through to opening a fresh one) — `seq DESC`
   * picks the most recently opened match so a repeat switch to the same
   * provider/account converges on the newest leg instead of an unspecified
   * one.
   */
  findLeg(sessionId: string, provider: string, profileId: string | null): LegRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${LEG_ROW_COLUMNS}
         FROM session_legs
         WHERE session_id = ? AND provider = ? AND profile_id IS ?
         ORDER BY seq DESC
         LIMIT 1`
      )
      .get(sessionId, provider, profileId) as LegRow | undefined;

    return row ?? null;
  },

  /**
   * Closes whatever leg is currently active for the session (if any), then
   * inserts and returns a new leg at the next `seq`. Runs in one transaction
   * so a reader never observes two legs active at once.
   */
  openLeg(input: OpenLegInput): LegRow {
    const db = getConnection();

    const open = db.transaction(() => {
      db.prepare(
        `UPDATE session_legs
         SET ended_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND ended_at IS NULL`
      ).run(input.sessionId);

      const nextSeqRow = db
        .prepare(`SELECT MAX(seq) AS maxSeq FROM session_legs WHERE session_id = ?`)
        .get(input.sessionId) as { maxSeq: number | null };
      const nextSeq = (nextSeqRow.maxSeq ?? -1) + 1;

      const legId = db.prepare(`SELECT ${SQLITE_UUID_SQL} AS id`).get() as { id: string };

      db.prepare(
        `INSERT INTO session_legs (
           leg_id, session_id, seq, provider, profile_id,
           provider_session_id, jsonl_path, profile_name_at_switch,
           started_at, ended_at
         )
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, CURRENT_TIMESTAMP, NULL)`
      ).run(
        legId.id,
        input.sessionId,
        nextSeq,
        input.provider,
        input.profileId,
        input.profileNameAtSwitch
      );

      return db
        .prepare(`SELECT ${LEG_ROW_COLUMNS} FROM session_legs WHERE leg_id = ?`)
        .get(legId.id) as LegRow;
    });

    return open();
  },

  /**
   * Reactivates an existing leg (the "resume an old leg" path) instead of
   * creating a new row. `started_at` is left untouched: it marks when the leg
   * was first opened, not each time it's resumed.
   */
  activateLeg(sessionId: string, legId: string): void {
    const db = getConnection();

    const activate = db.transaction(() => {
      db.prepare(
        `UPDATE session_legs
         SET ended_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND ended_at IS NULL`
      ).run(sessionId);

      db.prepare(
        `UPDATE session_legs
         SET ended_at = NULL
         WHERE leg_id = ?`
      ).run(legId);
    });

    activate();
  },

  attachProviderSessionId(legId: string, providerSessionId: string, jsonlPath: string | null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE session_legs
       SET provider_session_id = ?, jsonl_path = ?
       WHERE leg_id = ?`
    ).run(providerSessionId, jsonlPath, legId);
  },

  findSessionIdByProviderSessionId(providerSessionId: string): string | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT session_id FROM session_legs WHERE provider_session_id = ? LIMIT 1`)
      .get(providerSessionId) as { session_id: string } | undefined;

    return row?.session_id ?? null;
  },
};
