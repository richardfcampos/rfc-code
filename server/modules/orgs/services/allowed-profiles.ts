/**
 * Resolves which profiles an org allows for a project.
 *
 * Shared by the policy service (enforcement) and the eligibility engine
 * (selection) so both answer from exactly one allow-list implementation.
 */

import { resolveOrgForProject } from '@/modules/orgs/services/org-resolver.service.js';
import type {
  AllowedProfile,
  AllowedProfilesResult,
  ListAllowedProfilesOptions,
  Org,
  OrgPolicyDeps,
  OrgProfileSummary,
} from '@/modules/orgs/orgs.types.js';

export interface AllowedProfilesContext extends AllowedProfilesResult {
  org: Org;
  /** Every known profile, indexed by id — callers need the provider and auth flag. */
  profilesById: Map<string, OrgProfileSummary>;
}

/**
 * Compatibility order for an org with no policies: the provider default first,
 * then registry order. It reproduces the pre-orgs behavior, where a new session
 * landed on the account flagged as default.
 */
function compatOrder(profiles: OrgProfileSummary[]): OrgProfileSummary[] {
  return [...profiles].sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
}

export function computeAllowedProfiles(
  projectPath: string | null | undefined,
  options: ListAllowedProfilesOptions,
  deps: OrgPolicyDeps,
): AllowedProfilesContext {
  const org = resolveOrgForProject(projectPath, options.projectName, deps);
  const profiles = deps.profiles.listProfiles();
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const provider = options.provider;
  const matchesProvider = (profileId: string): boolean =>
    !provider || profilesById.get(profileId)?.provider === provider;

  const policies = deps.orgs.policies.listByOrg(org.id);

  if (policies.length === 0) {
    const allowed: AllowedProfile[] = compatOrder(profiles)
      .filter((profile) => !provider || profile.provider === provider)
      .map((profile, index) => ({ profileId: profile.id, role: 'primary', priority: index }));

    return {
      org,
      orgId: org.id,
      orgName: org.name,
      policyManaged: false,
      fallbackThreshold: org.fallbackThreshold,
      profiles: allowed,
      profilesById,
    };
  }

  const allowed: AllowedProfile[] = [];
  for (const policy of policies) {
    if (!profilesById.has(policy.profile_id)) {
      // The profile was deleted but its policy survived: skip it rather than
      // offering an id that no spawn could ever use.
      console.warn('[orgs] policy references a missing profile', {
        orgId: org.id,
        orgName: org.name,
        profileId: policy.profile_id,
      });
      continue;
    }
    if (!matchesProvider(policy.profile_id)) {
      continue;
    }
    allowed.push({
      profileId: policy.profile_id,
      role: policy.role,
      priority: policy.priority,
    });
  }

  return {
    org,
    orgId: org.id,
    orgName: org.name,
    policyManaged: true,
    fallbackThreshold: org.fallbackThreshold,
    profiles: allowed,
    profilesById,
  };
}

/** Strips the internal fields before the result crosses the module boundary. */
export function toAllowedProfilesResult(context: AllowedProfilesContext): AllowedProfilesResult {
  return {
    orgId: context.orgId,
    orgName: context.orgName,
    policyManaged: context.policyManaged,
    fallbackThreshold: context.fallbackThreshold,
    profiles: context.profiles,
  };
}
