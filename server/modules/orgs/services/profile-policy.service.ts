/**
 * Enforcement surface of the Orgs module.
 *
 * Every spawn path funnels through here: it answers which accounts a project
 * may use, refuses the ones it may not, and picks one when the caller has no
 * preference. Denials and automatic fallbacks are always logged — an account
 * silently swapped underneath a user is the failure mode this module exists to
 * prevent.
 */

import { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';
import {
  computeAllowedProfiles,
  toAllowedProfilesResult,
  type AllowedProfilesContext,
} from '@/modules/orgs/services/allowed-profiles.js';
import {
  evaluateProfiles,
  findEligibleFallback,
  findPrimaryUnderThreshold,
  findPrimaryWithUnknownUsage,
  type EvaluatedProfile,
  type Evaluation,
} from '@/modules/orgs/services/profile-eligibility.js';
import type {
  AllowedProfile,
  AllowedProfilesResult,
  ListAllowedProfilesOptions,
  OrgPolicyDeps,
  ResolveProfileForSpawnOptions,
  SpawnProfileSelection,
} from '@/modules/orgs/orgs.types.js';

/** Audit rows are keyed by project name; derive one when the caller only has a path. */
function resolveProjectName(
  projectPath: string | null | undefined,
  projectName: string | null | undefined,
): string {
  const explicit = typeof projectName === 'string' ? projectName.trim() : '';
  if (explicit) {
    return explicit;
  }
  const path = typeof projectPath === 'string' ? projectPath.trim().replace(/\\/g, '/') : '';
  if (!path) {
    return 'unknown';
  }
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function listAllowedProfiles(
  projectPath: string | null | undefined,
  options: ListAllowedProfilesOptions,
  deps: OrgPolicyDeps,
): AllowedProfilesResult {
  return toAllowedProfilesResult(computeAllowedProfiles(projectPath, options, deps));
}

/**
 * Returns the allow-list entry for a profile, or throws with the reason.
 *
 * An org with no policies allows every existing profile (the documented
 * compatibility path); an unknown profile id is still denied, because letting
 * it through would push an unresolvable account into a spawn.
 */
function requireAllowed(
  context: AllowedProfilesContext,
  projectPath: string | null | undefined,
  profileId: string,
): AllowedProfile {
  const match = context.profiles.find((profile) => profile.profileId === profileId);
  if (match) {
    return match;
  }

  const reason = context.profilesById.has(profileId)
    ? `Profile is not allowed in organization "${context.orgName}".`
    : `Profile "${profileId}" does not exist.`;

  console.warn('[orgs] profile denied', {
    orgId: context.orgId,
    orgName: context.orgName,
    projectPath: projectPath ?? null,
    profileId,
    policyManaged: context.policyManaged,
    reason,
  });

  throw new OrgPolicyError(reason, { orgId: context.orgId, profileId });
}

export function assertProfileAllowed(
  projectPath: string | null | undefined,
  profileId: string,
  deps: OrgPolicyDeps,
): void {
  requireAllowed(computeAllowedProfiles(projectPath, {}, deps), projectPath, profileId);
}

/**
 * Records and reports one automatic fallback grant.
 *
 * The audit insert is best-effort: it is a record of what happened, not a gate,
 * so a failed write costs a log line rather than the user's session.
 */
function grantFallback(
  evaluation: Evaluation,
  profile: EvaluatedProfile,
  reason: string,
  projectName: string,
  sessionId: string | null,
  deps: OrgPolicyDeps,
): SpawnProfileSelection {
  console.warn('[orgs] fallback profile granted', {
    orgId: evaluation.context.orgId,
    orgName: evaluation.context.orgName,
    projectName,
    profileId: profile.profileId,
    reason,
    primaryUsagePct: evaluation.primaryUsagePct,
  });

  try {
    deps.audit.insert({
      orgId: evaluation.context.orgId,
      profileId: profile.profileId,
      projectName,
      sessionId,
      reason,
      primaryUsagePct: evaluation.primaryUsagePct,
    });
  } catch (error) {
    console.warn('[orgs] failed to record fallback audit', {
      orgId: evaluation.context.orgId,
      profileId: profile.profileId,
      projectName,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    profileId: profile.profileId,
    role: 'fallback',
    fallback: { reason, primaryUsagePct: evaluation.primaryUsagePct },
  };
}

/**
 * Picks the account a spawn should run on.
 *
 * An explicitly requested profile only has to pass the allow-list — quota is
 * not a permission boundary and must never override a deliberate choice. With
 * no request the walk is: a primary below the threshold, then an unlocked
 * fallback (audited), then a primary whose usage is unreadable, then the org's
 * first choice anyway. That last step matters: running out of quota must not
 * make the app refuse to start a session, which is what would otherwise happen
 * to an installation with a single heavily-used account.
 */
export async function resolveProfileForSpawn(
  projectPath: string | null | undefined,
  options: ResolveProfileForSpawnOptions,
  deps: OrgPolicyDeps,
): Promise<SpawnProfileSelection> {
  const projectName = resolveProjectName(projectPath, options.projectName);
  const sessionId = options.sessionId ?? null;

  if (options.requestedProfileId) {
    const context = computeAllowedProfiles(projectPath, { projectName }, deps);
    const match = requireAllowed(context, projectPath, options.requestedProfileId);
    return { profileId: match.profileId, role: match.role };
  }

  const evaluation = await evaluateProfiles(
    projectPath,
    { provider: options.provider, projectName },
    deps,
  );

  const underThreshold = findPrimaryUnderThreshold(evaluation);
  if (underThreshold) {
    return { profileId: underThreshold.profileId, role: 'primary' };
  }

  const fallback = findEligibleFallback(evaluation);
  if (fallback) {
    const reason = evaluation.fallbackReason ?? 'no primary profile is available';
    return grantFallback(evaluation, fallback, reason, projectName, sessionId, deps);
  }

  const unknownUsage = findPrimaryWithUnknownUsage(evaluation);
  if (unknownUsage) {
    return { profileId: unknownUsage.profileId, role: 'primary' };
  }

  const lastResort = evaluation.primaries[0] ?? evaluation.all[0];
  if (!lastResort) {
    const reason = evaluation.context.policyManaged
      ? `Organization "${evaluation.context.orgName}" allows no profile for this project.`
      : 'No profile is available for this project.';
    console.warn('[orgs] spawn denied: no allowed profile', {
      orgId: evaluation.context.orgId,
      orgName: evaluation.context.orgName,
      projectName,
      provider: options.provider ?? null,
      policyManaged: evaluation.context.policyManaged,
    });
    throw new OrgPolicyError(reason, { orgId: evaluation.context.orgId });
  }

  if (lastResort.role === 'fallback') {
    // Only fallbacks are left (every one of them signed out, or the org lists
    // no primary at all) — still a fallback use, so it is still audited.
    const reason = evaluation.fallbackReason ?? 'no primary profile is available';
    return grantFallback(evaluation, lastResort, reason, projectName, sessionId, deps);
  }

  console.warn('[orgs] no profile below the usage threshold; using the org first choice', {
    orgId: evaluation.context.orgId,
    orgName: evaluation.context.orgName,
    projectName,
    profileId: lastResort.profileId,
    role: lastResort.role,
    primaryUsagePct: evaluation.primaryUsagePct,
  });
  return { profileId: lastResort.profileId, role: lastResort.role };
}

export { OrgPolicyError };
