/**
 * Persistence for account profiles.
 *
 * Kept inside the profiles module (rather than the shared database repository
 * folder) so all multi-account logic lives together and upstream files stay
 * untouched. Uses the shared SQLite singleton like every other repository.
 */

import { getConnection } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';

export type ProfileRow = {
  id: string;
  provider: LLMProvider;
  name: string;
  slug: string;
  created_at: string;
  /** Default compression level for this profile's sessions; NULL = off. */
  caveman_mode: string | null;
  /** Command-rewriting level installed in this profile's settings.json. */
  rtk_mode: string | null;
};

export type CreateProfileRow = {
  id: string;
  provider: LLMProvider;
  name: string;
  slug: string;
};

const PROFILE_COLUMNS = 'id, provider, name, slug, created_at, caveman_mode, rtk_mode';

export const profilesRepository = {
  insert(row: CreateProfileRow): ProfileRow {
    const db = getConnection();
    db.prepare(
      `INSERT INTO profiles (id, provider, name, slug) VALUES (?, ?, ?, ?)`,
    ).run(row.id, row.provider, row.name, row.slug);

    // Read back so the caller sees the DB-assigned created_at timestamp.
    return profilesRepository.getById(row.id) as ProfileRow;
  },

  list(provider?: LLMProvider): ProfileRow[] {
    const db = getConnection();
    if (provider) {
      return db
        .prepare(
          `SELECT ${PROFILE_COLUMNS} FROM profiles WHERE provider = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(provider) as ProfileRow[];
    }
    return db
      .prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles ORDER BY created_at ASC, id ASC`)
      .all() as ProfileRow[];
  },

  getById(id: string): ProfileRow | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE id = ?`)
      .get(id) as ProfileRow | undefined;
    return row ?? null;
  },

  existsSlug(provider: LLMProvider, slug: string): boolean {
    const db = getConnection();
    return Boolean(
      db
        .prepare(`SELECT 1 FROM profiles WHERE provider = ? AND slug = ? LIMIT 1`)
        .get(provider, slug),
    );
  },

  deleteById(id: string): boolean {
    const db = getConnection();
    return db.prepare(`DELETE FROM profiles WHERE id = ?`).run(id).changes > 0;
  },

  /**
   * Updates the agent tooling levels.
   *
   * Only the keys present are written, so setting one level never silently
   * resets the other back to its default.
   */
  updateToolingModes(
    id: string,
    modes: { cavemanMode?: string | null; rtkMode?: string | null },
  ): ProfileRow | null {
    const db = getConnection();
    const assignments: string[] = [];
    const values: (string | null)[] = [];

    if ('cavemanMode' in modes) {
      assignments.push('caveman_mode = ?');
      values.push(modes.cavemanMode ?? null);
    }
    if ('rtkMode' in modes) {
      assignments.push('rtk_mode = ?');
      values.push(modes.rtkMode ?? null);
    }
    if (assignments.length === 0) {
      return profilesRepository.getById(id);
    }

    db.prepare(`UPDATE profiles SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
    return profilesRepository.getById(id);
  },

  /**
   * Counts non-archived sessions bound to a profile. Used as the delete guard:
   * a profile that still serves live sessions must not be removed underneath
   * them.
   */
  countActiveSessions(profileId: string): number {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM sessions WHERE profile_id = ? AND isArchived = 0`,
      )
      .get(profileId) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  },
};
