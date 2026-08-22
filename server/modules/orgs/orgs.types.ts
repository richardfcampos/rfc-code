/**
 * Contracts for the Orgs module.
 *
 * Database, profile registry and plan-usage access are expressed as narrow
 * ports: the policy engine decides who may run where, and that decision has to
 * be testable without a SQLite file or an outbound HTTP call. The concrete
 * adapters are bound in one place only — `orgs.module.ts`.
 */

import type { LLMProvider } from '@/shared/types.js';

/** Callers frequently have "no provider filter" as `null` or `undefined`; accept both. */
export type LLMProviderOption = LLMProvider | null | undefined;

export type OrgProjectRuleKind = 'path_prefix' | 'project_name';
export type OrgProfileRole = 'primary' | 'fallback';

/**
 * Row shapes consumed from the Database module.
 *
 * Copied structurally rather than imported: cross-module imports go through
 * barrels, and these rows are a stable persistence contract this module reads
 * but never writes.
 */
export interface OrgRecord {
  id: string;
  name: string;
  is_default: number;
  fallback_threshold: number;
  created_at: string;
}

export interface OrgProjectRuleRecord {
  id: string;
  org_id: string;
  kind: OrgProjectRuleKind;
  pattern: string;
  created_at: string;
}

export interface OrgProfilePolicyRecord {
  id: string;
  org_id: string;
  profile_id: string;
  role: OrgProfileRole;
  priority: number;
  created_at: string;
}

export interface OrgsRepositoryGateway {
  getDefault(): OrgRecord | null;
  getById(id: string): OrgRecord | null;
  rules: {
    listAll(): OrgProjectRuleRecord[];
  };
  policies: {
    /** Ordered primary-first, then by priority — the order policy decisions walk. */
    listByOrg(orgId: string): OrgProfilePolicyRecord[];
  };
}

export interface OrgFallbackAuditGateway {
  insert(entry: {
    orgId: string;
    profileId: string;
    projectName: string;
    sessionId?: string | null;
    reason: string;
    primaryUsagePct?: number | null;
  }): unknown;
}

/** The slice of a profile the policy engine needs; a superset arrives in production. */
export interface OrgProfileSummary {
  id: string;
  provider: LLMProvider;
  authenticated: boolean;
  isDefault: boolean;
}

export interface OrgProfilesGateway {
  listProfiles(): OrgProfileSummary[];
}

/** The slice of a plan-usage snapshot the policy engine reads. */
export interface OrgUsageSnapshot {
  supported: boolean;
  status: 'ok' | 'unauthenticated' | 'unavailable';
  windows: { utilization: number }[];
}

export interface OrgUsageGateway {
  getUsage(profileId: string): Promise<OrgUsageSnapshot>;
}

export interface OrgResolverDeps {
  orgs: OrgsRepositoryGateway;
}

export interface OrgPolicyDeps extends OrgResolverDeps {
  profiles: OrgProfilesGateway;
  usage: OrgUsageGateway;
  audit: OrgFallbackAuditGateway;
}

/** An organization, normalized away from its row representation. */
export interface Org {
  id: string;
  name: string;
  isDefault: boolean;
  /** Usage percentage at or above which a primary stops being preferred. */
  fallbackThreshold: number;
}

export interface AllowedProfile {
  profileId: string;
  role: OrgProfileRole;
  priority: number;
}

export interface AllowedProfilesResult {
  orgId: string;
  orgName: string;
  /**
   * False when the org has no policies at all: every profile is allowed, which
   * is the compatibility path for installations that never configured orgs.
   */
  policyManaged: boolean;
  fallbackThreshold: number;
  profiles: AllowedProfile[];
}

export interface SpawnFallbackInfo {
  /** Human-readable explanation, surfaced to the client and stored in the audit. */
  reason: string;
  /** Highest known primary usage at decision time; null when no primary reported one. */
  primaryUsagePct: number | null;
}

export interface SpawnProfileSelection {
  profileId: string;
  role: OrgProfileRole;
  /** Present only when a fallback was picked automatically. */
  fallback?: SpawnFallbackInfo;
}

export interface ProfileRecommendation {
  profileId: string;
  role: OrgProfileRole;
  usagePct: number | null;
  reason: string;
}

export interface ListAllowedProfilesOptions {
  provider?: LLMProvider;
  projectName?: string | null;
}

export interface ResolveProfileForSpawnOptions {
  provider?: LLMProvider;
  requestedProfileId?: string | null;
  projectName?: string | null;
  sessionId?: string | null;
}

export interface OrgResolverService {
  resolveOrgForProject(projectPath?: string | null, projectName?: string | null): Org;
}

export interface OrgPolicyService {
  listAllowedProfiles(
    projectPath?: string | null,
    options?: ListAllowedProfilesOptions,
  ): AllowedProfilesResult;
  assertProfileAllowed(projectPath: string | null | undefined, profileId: string): void;
  resolveProfileForSpawn(
    projectPath?: string | null,
    options?: ResolveProfileForSpawnOptions,
  ): Promise<SpawnProfileSelection>;
}

export interface OrgRecommendService {
  recommend(
    projectPath?: string | null,
    provider?: LLMProviderOption,
    options?: { projectName?: string | null },
  ): Promise<ProfileRecommendation>;
}
