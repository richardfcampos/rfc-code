/**
 * Write side of the Orgs module: organizations, project rules and the per-org
 * profile allow-list.
 *
 * Owns all validation of untrusted request bodies before anything reaches
 * storage, so the route layer stays a transport adapter. Named error classes
 * extend the shared `AppError`, which the global error middleware already maps
 * to status codes without route-level branching.
 *
 * Storage and the transaction boundary arrive as ports: the policy allow-list
 * is a security boundary, and its rules have to be testable without a database
 * file.
 */

import type {
  OrgProfilePolicyRow,
  OrgProjectRuleRow,
  OrgRow,
} from '@/modules/database/index.js';
import type { OrgProfileRole, OrgProjectRuleKind } from '@/modules/orgs/orgs.types.js';
import { AppError } from '@/shared/utils.js';

const ORG_NAME_MAX_LENGTH = 120;
const RULE_PATTERN_MAX_LENGTH = 500;
const RULE_KINDS: readonly OrgProjectRuleKind[] = ['path_prefix', 'project_name'];
const POLICY_ROLES: readonly OrgProfileRole[] = ['primary', 'fallback'];

export class OrgValidationError extends AppError {
  constructor(message: string) {
    super(message, { code: 'ORG_VALIDATION_ERROR', statusCode: 400 });
    this.name = 'OrgValidationError';
  }
}

export class OrgNameTakenError extends AppError {
  constructor(name: string) {
    super(`An organization named "${name}" already exists`, {
      code: 'ORG_NAME_TAKEN',
      statusCode: 400,
    });
    this.name = 'OrgNameTakenError';
  }
}

export class OrgNotFoundError extends AppError {
  constructor(id: string) {
    super(`Organization "${id}" not found`, { code: 'ORG_NOT_FOUND', statusCode: 404 });
    this.name = 'OrgNotFoundError';
  }
}

export class OrgRuleNotFoundError extends AppError {
  constructor(id: string) {
    super(`Project rule "${id}" not found`, { code: 'ORG_RULE_NOT_FOUND', statusCode: 404 });
    this.name = 'OrgRuleNotFoundError';
  }
}

/**
 * Deleting the catch-all org would leave projects with no org to resolve to, so
 * it is refused here as well as in the repository.
 */
export class DefaultOrgProtectedError extends AppError {
  constructor() {
    super('The default organization cannot be deleted', {
      code: 'ORG_DEFAULT_PROTECTED',
      statusCode: 400,
    });
    this.name = 'DefaultOrgProtectedError';
  }
}

export interface OrgRuleView {
  id: string;
  kind: OrgProjectRuleKind;
  pattern: string;
}

export interface OrgPolicyView {
  profileId: string;
  role: OrgProfileRole;
  priority: number;
}

export interface OrgDetail {
  id: string;
  name: string;
  isDefault: boolean;
  fallbackThreshold: number;
  rules: OrgRuleView[];
  policies: OrgPolicyView[];
}

/** The slice of the orgs repository this service writes through. */
export interface OrgsAdminRepository {
  list(): OrgRow[];
  getById(id: string): OrgRow | null;
  create(name: string, fallbackThreshold?: number): OrgRow;
  update(id: string, fields: { name?: string; fallbackThreshold?: number }): OrgRow | null;
  delete(id: string): boolean;
  rules: {
    listAll(): OrgProjectRuleRow[];
    add(orgId: string, kind: OrgProjectRuleKind, pattern: string): OrgProjectRuleRow;
    delete(id: string): boolean;
  };
  policies: {
    listByOrg(orgId: string): OrgProfilePolicyRow[];
    upsert(
      orgId: string,
      profileId: string,
      role: OrgProfileRole,
      priority?: number,
    ): OrgProfilePolicyRow;
    delete(id: string): boolean;
  };
}

export interface OrgAdminDeps {
  repository: OrgsAdminRepository;
  /** Runs one unit of work atomically; the policy replace depends on it. */
  runInTransaction: <T>(work: () => T) => T;
  /** Known profile ids, so a policy can never point at an account that is gone. */
  listProfileIds: () => string[];
}

/** Raw request bodies straight off the wire; every field is unvalidated. */
export type OrgRequestBody = Record<string, unknown>;

export interface OrgAdminService {
  listOrgs(): OrgDetail[];
  createOrg(body: OrgRequestBody): OrgDetail;
  updateOrg(id: string, body: OrgRequestBody): OrgDetail;
  deleteOrg(id: string): void;
  addRule(orgId: string, body: OrgRequestBody): OrgRuleView;
  deleteRule(orgId: string, ruleId: string): void;
  replacePolicies(orgId: string, body: unknown): OrgPolicyView[];
}

function readName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) {
    throw new OrgValidationError('name is required');
  }
  if (name.length > ORG_NAME_MAX_LENGTH) {
    throw new OrgValidationError(`name must be ${ORG_NAME_MAX_LENGTH} characters or fewer`);
  }
  return name;
}

function readFallbackThreshold(value: unknown): number {
  const threshold = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    throw new OrgValidationError('fallbackThreshold must be an integer between 0 and 100');
  }
  return threshold;
}

function readRuleKind(value: unknown): OrgProjectRuleKind {
  if (typeof value !== 'string' || !RULE_KINDS.includes(value as OrgProjectRuleKind)) {
    throw new OrgValidationError(`kind must be one of: ${RULE_KINDS.join(', ')}`);
  }
  return value as OrgProjectRuleKind;
}

function readRulePattern(value: unknown): string {
  const pattern = typeof value === 'string' ? value.trim() : '';
  if (!pattern) {
    throw new OrgValidationError('pattern is required');
  }
  if (pattern.length > RULE_PATTERN_MAX_LENGTH) {
    throw new OrgValidationError(`pattern must be ${RULE_PATTERN_MAX_LENGTH} characters or fewer`);
  }
  return pattern;
}

function readPolicies(body: unknown, knownProfileIds: string[]): OrgPolicyView[] {
  if (!Array.isArray(body)) {
    throw new OrgValidationError('body must be an array of policies');
  }

  const known = new Set(knownProfileIds);
  const seen = new Set<string>();

  return body.map((entry, index) => {
    const record = (entry ?? {}) as OrgRequestBody;
    const profileId = typeof record.profileId === 'string' ? record.profileId.trim() : '';
    if (!profileId) {
      throw new OrgValidationError(`policies[${index}].profileId is required`);
    }
    if (!known.has(profileId)) {
      throw new OrgValidationError(`profile "${profileId}" does not exist`);
    }
    // A profile holds at most one policy per org, so a repeated id would
    // silently collapse into whichever entry happened to be written last.
    if (seen.has(profileId)) {
      throw new OrgValidationError(`profile "${profileId}" is listed twice`);
    }
    seen.add(profileId);

    const role = typeof record.role === 'string' ? record.role : '';
    if (!POLICY_ROLES.includes(role as OrgProfileRole)) {
      throw new OrgValidationError(
        `policies[${index}].role must be one of: ${POLICY_ROLES.join(', ')}`,
      );
    }

    const rawPriority = record.priority;
    const priority = rawPriority === undefined || rawPriority === null ? index : Number(rawPriority);
    if (!Number.isInteger(priority) || priority < 0) {
      throw new OrgValidationError(`policies[${index}].priority must be a non-negative integer`);
    }

    return { profileId, role: role as OrgProfileRole, priority };
  });
}

function toRuleView(row: OrgProjectRuleRow): OrgRuleView {
  return { id: row.id, kind: row.kind, pattern: row.pattern };
}

function toPolicyView(row: OrgProfilePolicyRow): OrgPolicyView {
  return { profileId: row.profile_id, role: row.role, priority: row.priority };
}

export function createOrgAdminService(deps: OrgAdminDeps): OrgAdminService {
  const { repository } = deps;

  const requireOrg = (id: string): OrgRow => {
    const org = repository.getById(id);
    if (!org) {
      throw new OrgNotFoundError(id);
    }
    return org;
  };

  // Names identify orgs on every screen, so a second "Personal" differing only
  // by case is refused instead of being left for the user to tell apart.
  const assertNameAvailable = (name: string, excludeOrgId?: string): void => {
    const taken = repository
      .list()
      .some((org) => org.id !== excludeOrgId && org.name.toLowerCase() === name.toLowerCase());
    if (taken) {
      throw new OrgNameTakenError(name);
    }
  };

  const describe = (org: OrgRow, rules: OrgProjectRuleRow[]): OrgDetail => ({
    id: org.id,
    name: org.name,
    isDefault: org.is_default === 1,
    fallbackThreshold: org.fallback_threshold,
    rules: rules.filter((rule) => rule.org_id === org.id).map(toRuleView),
    policies: repository.policies.listByOrg(org.id).map(toPolicyView),
  });

  return {
    listOrgs(): OrgDetail[] {
      const rules = repository.rules.listAll();
      return repository.list().map((org) => describe(org, rules));
    },

    createOrg(body: OrgRequestBody): OrgDetail {
      const name = readName(body.name);
      const threshold = body.fallbackThreshold === undefined
        ? undefined
        : readFallbackThreshold(body.fallbackThreshold);

      assertNameAvailable(name);
      return describe(repository.create(name, threshold), []);
    },

    updateOrg(id: string, body: OrgRequestBody): OrgDetail {
      const org = requireOrg(id);
      const fields: { name?: string; fallbackThreshold?: number } = {};

      if (body.name !== undefined) {
        fields.name = readName(body.name);
        assertNameAvailable(fields.name, org.id);
      }
      if (body.fallbackThreshold !== undefined) {
        fields.fallbackThreshold = readFallbackThreshold(body.fallbackThreshold);
      }

      const updated = repository.update(org.id, fields) ?? org;
      return describe(updated, repository.rules.listAll());
    },

    deleteOrg(id: string): void {
      const org = requireOrg(id);
      if (org.is_default === 1) {
        throw new DefaultOrgProtectedError();
      }
      // Rules and policies go with the org (ON DELETE CASCADE), so projects
      // that matched it fall back to the default org.
      if (!repository.delete(org.id)) {
        throw new OrgNotFoundError(org.id);
      }
    },

    addRule(orgId: string, body: OrgRequestBody): OrgRuleView {
      const org = requireOrg(orgId);
      const kind = readRuleKind(body.kind);
      const pattern = readRulePattern(body.pattern);
      return toRuleView(repository.rules.add(org.id, kind, pattern));
    },

    deleteRule(orgId: string, ruleId: string): void {
      const org = requireOrg(orgId);
      // Scoped to the org in the path: a rule id alone must never be enough to
      // reshape another org's routing.
      const owned = repository.rules
        .listAll()
        .some((rule) => rule.id === ruleId && rule.org_id === org.id);
      if (!owned || !repository.rules.delete(ruleId)) {
        throw new OrgRuleNotFoundError(ruleId);
      }
    },

    replacePolicies(orgId: string, body: unknown): OrgPolicyView[] {
      const org = requireOrg(orgId);
      const policies = readPolicies(body, deps.listProfileIds());

      // One transaction: a half-applied replace would either lock everyone out
      // of the org or leave a revoked account allowed.
      const saved = deps.runInTransaction(() => {
        for (const existing of repository.policies.listByOrg(org.id)) {
          repository.policies.delete(existing.id);
        }
        for (const policy of policies) {
          repository.policies.upsert(org.id, policy.profileId, policy.role, policy.priority);
        }
        return repository.policies.listByOrg(org.id);
      });

      return saved.map(toPolicyView);
    },
  };
}
