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
  /** 1 when new sessions of this provider fall back to this account. */
  is_default: number;
};

export type CreateProfileRow = {
  id: string;
  provider: LLMProvider;
  name: string;
  slug: string;
};

const PROFILE_COLUMNS =
  'id, provider, name, slug, created_at, caveman_mode, rtk_mode, is_default';

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

  /** The account new sessions of this provider fall back to, if one was set. */
  getDefault(provider: LLMProvider): ProfileRow | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE provider = ? AND is_default = 1`)
      .get(provider) as ProfileRow | undefined;
    return row ?? null;
  },

  /**
   * Promotes one profile to its provider's default, demoting the previous one.
   *
   * Both writes run in a single transaction: the partial unique index rejects
   * two defaults for a provider, so demoting after promoting — or promoting
   * without demoting — would throw and leave the old default in place.
   */
  setDefault(id: string, provider: LLMProvider): ProfileRow | null {
    const db = getConnection();
    db.transaction(() => {
      db.prepare(
        `UPDATE profiles SET is_default = 0 WHERE provider = ? AND id <> ?`,
      ).run(provider, id);
      db.prepare(`UPDATE profiles SET is_default = 1 WHERE id = ?`).run(id);
    })();
    return profilesRepository.getById(id);
  },

  /** Demotes a profile, leaving its provider with no default at all. */
  clearDefault(id: string): ProfileRow | null {
    const db = getConnection();
    db.prepare(`UPDATE profiles SET is_default = 0 WHERE id = ?`).run(id);
    return profilesRepository.getById(id);
  },

  /**
   * Detaches every session bound to a profile. A NULL profile_id falls back to
   * the provider CLI's default config directory, so detached sessions stay
   * openable after their profile is gone.
   */
  detachSessions(profileId: string): number {
    const db = getConnection();
    return db
      .prepare(`UPDATE sessions SET profile_id = NULL WHERE profile_id = ?`)
      .run(profileId).changes;
  },
};
