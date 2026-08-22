/**
 * Decides which allowed profile a project should actually run on.
 *
 * The rule the whole feature hangs on: a fallback account is unlocked only when
 * every primary of the requested provider is demonstrably unusable — at or above
 * the org threshold, or signed out. A primary whose usage cannot be read is
 * *not* proof of anything, so it keeps the fallback locked. Guessing here would
 * quietly spend a second subscription.
 */

import {
  computeAllowedProfiles,
  type AllowedProfilesContext,
} from '@/modules/orgs/services/allowed-profiles.js';
import type {
  AllowedProfile,
  ListAllowedProfilesOptions,
  OrgPolicyDeps,
  OrgProfileSummary,
} from '@/modules/orgs/orgs.types.js';

export type UsageState =
  | { kind: 'usage'; pct: number }
  | { kind: 'unauthenticated' }
  | { kind: 'unknown' };

export interface EvaluatedProfile extends AllowedProfile {
  usage: UsageState;
}

export interface Evaluation {
  context: AllowedProfilesContext;
  /** Allow-list order, primaries before fallbacks. */
  all: EvaluatedProfile[];
  primaries: EvaluatedProfile[];
  fallbacks: EvaluatedProfile[];
  fallbackEligible: boolean;
  /** Human explanation of why the fallback opened; null when it stayed locked. */
  fallbackReason: string | null;
  /** Highest usage reported by a primary at decision time, null when none reported one. */
  primaryUsagePct: number | null;
}

function highestUtilization(windows: { utilization: number }[]): number | null {
  let highest: number | null = null;
  for (const window of windows) {
    if (!Number.isFinite(window.utilization)) {
      continue;
    }
    const value = Math.min(100, Math.max(0, window.utilization));
    highest = highest === null ? value : Math.max(highest, value);
  }
  return highest;
}

async function readUsageState(
  profileId: string,
  profile: OrgProfileSummary | undefined,
  deps: OrgPolicyDeps,
): Promise<UsageState> {
  if (profile && !profile.authenticated) {
    // Signed-out accounts are known-unusable without paying for a fetch.
    return { kind: 'unauthenticated' };
  }

  try {
    const snapshot = await deps.usage.getUsage(profileId);
    if (snapshot.status === 'unauthenticated') {
      return { kind: 'unauthenticated' };
    }
    if (snapshot.status !== 'ok' || !snapshot.supported) {
      return { kind: 'unknown' };
    }
    const pct = highestUtilization(snapshot.windows);
    return pct === null ? { kind: 'unknown' } : { kind: 'usage', pct };
  } catch (error) {
    console.warn('[orgs] plan usage lookup failed; treating usage as unknown', {
      profileId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'unknown' };
  }
}

function describeFallbackReason(
  primaries: EvaluatedProfile[],
  threshold: number,
): string {
  if (primaries.length === 0) {
    return 'no primary profile is configured for this provider';
  }
  const hasOverThreshold = primaries.some(
    (profile) => profile.usage.kind === 'usage' && profile.usage.pct >= threshold,
  );
  const hasSignedOut = primaries.some((profile) => profile.usage.kind === 'unauthenticated');
  if (hasOverThreshold && hasSignedOut) {
    return `every primary profile is at or above the ${threshold}% usage threshold or signed out`;
  }
  if (hasSignedOut) {
    return 'every primary profile is signed out';
  }
  return `every primary profile is at or above the ${threshold}% usage threshold`;
}

/**
 * Resolves the org, its allow-list and the usage state of every allowed
 * profile, then answers whether the fallback tier is open.
 */
export async function evaluateProfiles(
  projectPath: string | null | undefined,
  options: ListAllowedProfilesOptions,
  deps: OrgPolicyDeps,
): Promise<Evaluation> {
  const context = computeAllowedProfiles(projectPath, options, deps);
  const threshold = context.fallbackThreshold;

  const all: EvaluatedProfile[] = await Promise.all(
    context.profiles.map(async (profile) => ({
      ...profile,
      usage: await readUsageState(
        profile.profileId,
        context.profilesById.get(profile.profileId),
        deps,
      ),
    })),
  );

  const byPriority = (left: AllowedProfile, right: AllowedProfile): number =>
    left.priority - right.priority;
  const primaries = all.filter((profile) => profile.role === 'primary').sort(byPriority);
  const fallbacks = all.filter((profile) => profile.role === 'fallback').sort(byPriority);

  const primaryUsagePct = primaries.reduce<number | null>((highest, profile) => {
    if (profile.usage.kind !== 'usage') {
      return highest;
    }
    return highest === null ? profile.usage.pct : Math.max(highest, profile.usage.pct);
  }, null);

  const everyPrimaryExhausted = primaries.every(
    (profile) =>
      profile.usage.kind === 'unauthenticated' ||
      (profile.usage.kind === 'usage' && profile.usage.pct >= threshold),
  );

  const fallbackEligible = fallbacks.length > 0 && everyPrimaryExhausted;

  return {
    context,
    all,
    primaries,
    fallbacks,
    fallbackEligible,
    fallbackReason: fallbackEligible ? describeFallbackReason(primaries, threshold) : null,
    primaryUsagePct,
  };
}

/** First primary still below the org threshold, in priority order. */
export function findPrimaryUnderThreshold(evaluation: Evaluation): EvaluatedProfile | null {
  const threshold = evaluation.context.fallbackThreshold;
  return (
    evaluation.primaries.find(
      (profile) => profile.usage.kind === 'usage' && profile.usage.pct < threshold,
    ) ?? null
  );
}

/** First primary whose usage could not be read — preferred over spending a fallback. */
export function findPrimaryWithUnknownUsage(evaluation: Evaluation): EvaluatedProfile | null {
  return evaluation.primaries.find((profile) => profile.usage.kind === 'unknown') ?? null;
}

/** First usable fallback; signed-out fallbacks are skipped since they cannot run. */
export function findEligibleFallback(evaluation: Evaluation): EvaluatedProfile | null {
  if (!evaluation.fallbackEligible) {
    return null;
  }
  return (
    evaluation.fallbacks.find((profile) => profile.usage.kind !== 'unauthenticated') ?? null
  );
}

export function usagePctOf(profile: EvaluatedProfile): number | null {
  return profile.usage.kind === 'usage' ? profile.usage.pct : null;
}
