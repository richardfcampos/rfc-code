/**
 * In-memory doubles for the Orgs ports.
 *
 * Policy decisions are the security boundary of this module, so every case has
 * to be reachable from a test without a database file or an HTTP call.
 */

import type {
  OrgFallbackAuditGateway,
  OrgPolicyDeps,
  OrgProfilePolicyRecord,
  OrgProfileRole,
  OrgProfileSummary,
  OrgProjectRuleKind,
  OrgProjectRuleRecord,
  OrgRecord,
  OrgUsageSnapshot,
} from '@/modules/orgs/orgs.types.js';

export interface AuditEntry {
  orgId: string;
  profileId: string;
  projectName: string;
  sessionId?: string | null;
  reason: string;
  primaryUsagePct?: number | null;
}

export interface FakeSetup {
  orgs?: OrgRecord[];
  rules?: OrgProjectRuleRecord[];
  policies?: OrgProfilePolicyRecord[];
  profiles?: OrgProfileSummary[];
  /** Snapshot (or thrown error) returned per profile id; missing means "unavailable". */
  usage?: Record<string, OrgUsageSnapshot | Error>;
  auditInsert?: OrgFallbackAuditGateway['insert'];
}

export function makeOrg(
  id: string,
  options: { name?: string; isDefault?: boolean; threshold?: number } = {},
): OrgRecord {
  return {
    id,
    name: options.name ?? id,
    is_default: options.isDefault ? 1 : 0,
    fallback_threshold: options.threshold ?? 85,
    created_at: '2026-01-01T00:00:00Z',
  };
}

export function makeRule(
  id: string,
  orgId: string,
  kind: OrgProjectRuleKind,
  pattern: string,
): OrgProjectRuleRecord {
  return { id, org_id: orgId, kind, pattern, created_at: '2026-01-01T00:00:00Z' };
}

export function makePolicy(
  orgId: string,
  profileId: string,
  role: OrgProfileRole,
  priority = 0,
): OrgProfilePolicyRecord {
  return {
    id: `policy-${orgId}-${profileId}`,
    org_id: orgId,
    profile_id: profileId,
    role,
    priority,
    created_at: '2026-01-01T00:00:00Z',
  };
}

export function makeProfile(
  id: string,
  options: { provider?: OrgProfileSummary['provider']; authenticated?: boolean; isDefault?: boolean } = {},
): OrgProfileSummary {
  return {
    id,
    provider: options.provider ?? 'claude',
    authenticated: options.authenticated ?? true,
    isDefault: options.isDefault ?? false,
  };
}

export function usageAt(pct: number): OrgUsageSnapshot {
  return { supported: true, status: 'ok', windows: [{ utilization: pct }] };
}

/** A reachable provider that simply has nothing to report — usage stays unknown. */
export const usageUnavailable: OrgUsageSnapshot = {
  supported: true,
  status: 'unavailable',
  windows: [],
};

export const usageUnauthenticated: OrgUsageSnapshot = {
  supported: false,
  status: 'unauthenticated',
  windows: [],
};

export interface FakeDeps {
  deps: OrgPolicyDeps;
  audits: AuditEntry[];
  usageCalls: string[];
}

export function createFakeDeps(setup: FakeSetup = {}): FakeDeps {
  const orgs = setup.orgs ?? [makeOrg('org-default', { name: 'Pessoal', isDefault: true })];
  const rules = setup.rules ?? [];
  const policies = setup.policies ?? [];
  const profiles = setup.profiles ?? [];
  const usage = setup.usage ?? {};
  const audits: AuditEntry[] = [];
  const usageCalls: string[] = [];

  const roleRank = (role: OrgProfileRole): number => (role === 'primary' ? 0 : 1);

  const deps: OrgPolicyDeps = {
    orgs: {
      getDefault: () => orgs.find((org) => org.is_default === 1) ?? null,
      getById: (id) => orgs.find((org) => org.id === id) ?? null,
      rules: {
        listAll: () => [...rules],
      },
      policies: {
        // Mirrors the repository ordering the production query guarantees.
        listByOrg: (orgId) =>
          policies
            .filter((policy) => policy.org_id === orgId)
            .sort(
              (left, right) =>
                roleRank(left.role) - roleRank(right.role) || left.priority - right.priority,
            ),
      },
    },
    profiles: {
      listProfiles: () => [...profiles],
    },
    usage: {
      getUsage: async (profileId) => {
        usageCalls.push(profileId);
        const entry = usage[profileId];
        if (entry instanceof Error) {
          throw entry;
        }
        return entry ?? usageUnavailable;
      },
    },
    audit: {
      insert:
        setup.auditInsert ??
        ((entry) => {
          audits.push(entry);
          return entry;
        }),
    },
  };

  return { deps, audits, usageCalls };
}

/**
 * Silences and records `console.warn` for the duration of a test.
 *
 * Denials and fallback grants must never be silent, so tests assert on what was
 * logged instead of letting the output scroll past.
 */
export async function captureWarnings<T>(
  run: () => T | Promise<T>,
): Promise<{ result: T; warnings: string[] }> {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  try {
    const result = await run();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}
