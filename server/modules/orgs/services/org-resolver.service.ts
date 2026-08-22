/**
 * Maps a project to the organization whose policies govern it.
 *
 * Path rules win over name rules, and the longest matching path wins, so a
 * nested workspace (`/work/acme/backend`) can be governed by a stricter org
 * than its parent (`/work`) without deleting the broader rule.
 */

import { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';
import type {
  Org,
  OrgProjectRuleRecord,
  OrgRecord,
  OrgResolverDeps,
} from '@/modules/orgs/orgs.types.js';

/** Windows separators and trailing slashes are cosmetic; comparisons ignore both. */
function normalizePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.replace(/\/+$/, '');
  }
  return normalized;
}

function basename(projectPath: string): string {
  const normalized = normalizePath(projectPath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

/**
 * Prefix matching stops at a path boundary: `/work/acme` must not claim
 * `/work/acme-archive`, which is a different project entirely.
 */
function matchesPathPrefix(projectPath: string, pattern: string): boolean {
  const path = normalizePath(projectPath);
  const prefix = normalizePath(pattern);
  if (!prefix) {
    return false;
  }
  return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

/** Longest pattern first; ties broken by rule id so resolution is deterministic. */
function pickBestRule(rules: OrgProjectRuleRecord[]): OrgProjectRuleRecord | null {
  let best: OrgProjectRuleRecord | null = null;
  for (const rule of rules) {
    if (!best) {
      best = rule;
      continue;
    }
    const candidateLength = normalizePath(rule.pattern).length;
    const bestLength = normalizePath(best.pattern).length;
    if (candidateLength > bestLength || (candidateLength === bestLength && rule.id < best.id)) {
      best = rule;
    }
  }
  return best;
}

export function toOrg(record: OrgRecord): Org {
  return {
    id: record.id,
    name: record.name,
    isDefault: record.is_default === 1,
    fallbackThreshold: record.fallback_threshold,
  };
}

function resolveDefaultOrg(deps: OrgResolverDeps, context: Record<string, unknown>): Org {
  const fallback = deps.orgs.getDefault();
  if (!fallback) {
    // Never fail open: without a catch-all org there is no policy to apply and
    // silently allowing everything would defeat the allow-list.
    console.warn('[orgs] no default organization configured', context);
    throw new OrgPolicyError(
      'No default organization is configured, so no profile can be authorized.',
      context,
    );
  }
  return toOrg(fallback);
}

/**
 * Resolves the governing org for a project path.
 *
 * A missing or empty path lands on the default org rather than failing: plenty
 * of call sites (a brand-new session, a project that was never scanned) have
 * only a name, and the default org is the catch-all by construction.
 */
export function resolveOrgForProject(
  projectPath: string | null | undefined,
  projectName: string | null | undefined,
  deps: OrgResolverDeps,
): Org {
  const path = typeof projectPath === 'string' ? normalizePath(projectPath) : '';
  const explicitName = typeof projectName === 'string' ? projectName.trim() : '';
  const name = explicitName || (path ? basename(path) : '');

  if (!path && !name) {
    return resolveDefaultOrg(deps, { projectPath: projectPath ?? null });
  }

  const rules = deps.orgs.rules.listAll();

  const pathMatch = path
    ? pickBestRule(
        rules.filter((rule) => rule.kind === 'path_prefix' && matchesPathPrefix(path, rule.pattern)),
      )
    : null;

  const nameMatch = pathMatch
    ? null
    : pickBestRule(
        rules.filter((rule) => rule.kind === 'project_name' && rule.pattern.trim() === name),
      );

  const matched = pathMatch ?? nameMatch;
  if (!matched) {
    return resolveDefaultOrg(deps, { projectPath: path || null, projectName: name || null });
  }

  const org = deps.orgs.getById(matched.org_id);
  if (!org) {
    // A rule outliving its org means the row set is inconsistent; say so loudly
    // and fall back to the catch-all instead of pretending the rule matched.
    console.warn('[orgs] project rule points at a missing organization', {
      ruleId: matched.id,
      orgId: matched.org_id,
      projectPath: path || null,
    });
    return resolveDefaultOrg(deps, { projectPath: path || null, projectName: name || null });
  }

  return toOrg(org);
}
