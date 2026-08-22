/**
 * Advisory "which account should I use here" answer.
 *
 * Same walk as the spawn resolver, but read-only: nothing is written to the
 * fallback audit, because this runs whenever a screen renders and an audit that
 * records intentions instead of actual runs would be worthless.
 */

import { OrgPolicyError } from '@/modules/orgs/orgs.errors.js';
import {
  evaluateProfiles,
  findEligibleFallback,
  findPrimaryUnderThreshold,
  findPrimaryWithUnknownUsage,
  usagePctOf,
} from '@/modules/orgs/services/profile-eligibility.js';
import type {
  LLMProviderOption,
  OrgPolicyDeps,
  ProfileRecommendation,
} from '@/modules/orgs/orgs.types.js';

export async function recommend(
  projectPath: string | null | undefined,
  provider: LLMProviderOption,
  options: { projectName?: string | null },
  deps: OrgPolicyDeps,
): Promise<ProfileRecommendation> {
  const evaluation = await evaluateProfiles(
    projectPath,
    { provider: provider ?? undefined, projectName: options.projectName },
    deps,
  );
  const threshold = evaluation.context.fallbackThreshold;

  const underThreshold = findPrimaryUnderThreshold(evaluation);
  if (underThreshold) {
    return {
      profileId: underThreshold.profileId,
      role: 'primary',
      usagePct: usagePctOf(underThreshold),
      reason: `primary profile below the ${threshold}% usage threshold`,
    };
  }

  const fallback = findEligibleFallback(evaluation);
  if (fallback) {
    return {
      profileId: fallback.profileId,
      role: 'fallback',
      usagePct: usagePctOf(fallback),
      reason: evaluation.fallbackReason ?? 'no primary profile is available',
    };
  }

  const unknownUsage = findPrimaryWithUnknownUsage(evaluation);
  if (unknownUsage) {
    return {
      profileId: unknownUsage.profileId,
      role: 'primary',
      usagePct: null,
      reason: 'plan usage is unavailable, so the primary profile is kept',
    };
  }

  console.warn('[orgs] no eligible profile to recommend', {
    orgId: evaluation.context.orgId,
    orgName: evaluation.context.orgName,
    projectPath: projectPath ?? null,
    provider: provider ?? null,
    policyManaged: evaluation.context.policyManaged,
    primaryUsagePct: evaluation.primaryUsagePct,
  });

  throw new OrgPolicyError(
    `No eligible profile for organization "${evaluation.context.orgName}".`,
    { orgId: evaluation.context.orgId },
  );
}
