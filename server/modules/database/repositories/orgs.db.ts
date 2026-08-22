import { randomUUID } from 'node:crypto';

import type { Database } from 'better-sqlite3';

import { getConnection } from '@/modules/database/connection.js';

export type OrgRow = {
  id: string;
  name: string;
  is_default: number;
  fallback_threshold: number;
  created_at: string;
};

export type OrgProjectRuleRow = {
  id: string;
  org_id: string;
  kind: 'path_prefix' | 'project_name';
  pattern: string;
  created_at: string;
};

export type OrgProfilePolicyRow = {
  id: string;
  org_id: string;
  profile_id: string;
  role: 'primary' | 'fallback';
  priority: number;
  created_at: string;
};

const ORG_COLUMNS = 'id, name, is_default, fallback_threshold, created_at';
const RULE_COLUMNS = 'id, org_id, kind, pattern, created_at';
const POLICY_COLUMNS = 'id, org_id, profile_id, role, priority, created_at';

function getOrgById(db: Database, id: string): OrgRow | null {
  const row = db
    .prepare(`SELECT ${ORG_COLUMNS} FROM orgs WHERE id = ?`)
    .get(id) as OrgRow | undefined;
  return row ?? null;
}

export const orgsDb = {
  create(name: string, fallbackThreshold = 85): OrgRow {
    const db = getConnection();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO orgs (id, name, is_default, fallback_threshold) VALUES (?, ?, 0, ?)`,
    ).run(id, name, fallbackThreshold);
    return getOrgById(db, id) as OrgRow;
  },

  list(): OrgRow[] {
    const db = getConnection();
    return db
      .prepare(`SELECT ${ORG_COLUMNS} FROM orgs ORDER BY is_default DESC, name ASC`)
      .all() as OrgRow[];
  },

  getById(id: string): OrgRow | null {
    return getOrgById(getConnection(), id);
  },

  getDefault(): OrgRow | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${ORG_COLUMNS} FROM orgs WHERE is_default = 1 LIMIT 1`)
      .get() as OrgRow | undefined;
    return row ?? null;
  },

  /** Updates name and/or fallback threshold. Only the keys present are written. */
  update(id: string, fields: { name?: string; fallbackThreshold?: number }): OrgRow | null {
    const db = getConnection();
    const assignments: string[] = [];
    const values: (string | number)[] = [];

    if ('name' in fields && fields.name !== undefined) {
      assignments.push('name = ?');
      values.push(fields.name);
    }
    if ('fallbackThreshold' in fields && fields.fallbackThreshold !== undefined) {
      assignments.push('fallback_threshold = ?');
      values.push(fields.fallbackThreshold);
    }

    if (assignments.length === 0) {
      return getOrgById(db, id);
    }

    db.prepare(`UPDATE orgs SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
    return getOrgById(db, id);
  },

  /**
   * Deletes a non-default org. The default (catch-all) org must always exist
   * so the resolver never runs out of a fallback to land on; callers should
   * check `isDefault` first, but the guard is repeated here so a stray direct
   * call can never leave the app without a default org.
   */
  delete(id: string): boolean {
    const db = getConnection();
    const org = getOrgById(db, id);
    if (!org || org.is_default === 1) {
      return false;
    }
    return db.prepare('DELETE FROM orgs WHERE id = ?').run(id).changes > 0;
  },

  rules: {
    add(orgId: string, kind: 'path_prefix' | 'project_name', pattern: string): OrgProjectRuleRow {
      const db = getConnection();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO org_project_rules (id, org_id, kind, pattern) VALUES (?, ?, ?, ?)`,
      ).run(id, orgId, kind, pattern);
      return db
        .prepare(`SELECT ${RULE_COLUMNS} FROM org_project_rules WHERE id = ?`)
        .get(id) as OrgProjectRuleRow;
    },

    list(orgId: string): OrgProjectRuleRow[] {
      const db = getConnection();
      return db
        .prepare(
          `SELECT ${RULE_COLUMNS} FROM org_project_rules WHERE org_id = ? ORDER BY created_at ASC`,
        )
        .all(orgId) as OrgProjectRuleRow[];
    },

    /** Every rule across every org, used by the org resolver to pick a match. */
    listAll(): OrgProjectRuleRow[] {
      const db = getConnection();
      return db
        .prepare(`SELECT ${RULE_COLUMNS} FROM org_project_rules ORDER BY created_at ASC`)
        .all() as OrgProjectRuleRow[];
    },

    delete(id: string): boolean {
      const db = getConnection();
      return db.prepare('DELETE FROM org_project_rules WHERE id = ?').run(id).changes > 0;
    },
  },

  policies: {
    /**
     * Upserts the policy for one (org, profile) pair. Keyed by the UNIQUE
     * constraint so re-assigning a profile's role/priority updates the
     * existing row instead of producing a duplicate.
     */
    upsert(
      orgId: string,
      profileId: string,
      role: 'primary' | 'fallback',
      priority = 0,
    ): OrgProfilePolicyRow {
      const db = getConnection();
      const id = randomUUID();
      db.prepare(
        `INSERT INTO org_profile_policies (id, org_id, profile_id, role, priority)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(org_id, profile_id) DO UPDATE SET
           role = excluded.role,
           priority = excluded.priority`,
      ).run(id, orgId, profileId, role, priority);

      return db
        .prepare(
          `SELECT ${POLICY_COLUMNS} FROM org_profile_policies WHERE org_id = ? AND profile_id = ?`,
        )
        .get(orgId, profileId) as OrgProfilePolicyRow;
    },

    /**
     * Ordered primary-first (so the resolver tries primaries before
     * fallbacks), then by priority so callers can rank equal-role profiles.
     */
    listByOrg(orgId: string): OrgProfilePolicyRow[] {
      const db = getConnection();
      return db
        .prepare(
          `SELECT ${POLICY_COLUMNS} FROM org_profile_policies
           WHERE org_id = ?
           ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, priority ASC, created_at ASC`,
        )
        .all(orgId) as OrgProfilePolicyRow[];
    },

    delete(id: string): boolean {
      const db = getConnection();
      return db.prepare('DELETE FROM org_profile_policies WHERE id = ?').run(id).changes > 0;
    },

    /** Rewrites the priority of one policy row, e.g. after a drag-and-drop reorder. */
    reorder(id: string, priority: number): OrgProfilePolicyRow | null {
      const db = getConnection();
      db.prepare('UPDATE org_profile_policies SET priority = ? WHERE id = ?').run(priority, id);
      const row = db
        .prepare(`SELECT ${POLICY_COLUMNS} FROM org_profile_policies WHERE id = ?`)
        .get(id) as OrgProfilePolicyRow | undefined;
      return row ?? null;
    },
  },
};
