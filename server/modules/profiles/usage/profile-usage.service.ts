/**
 * Application service answering "how much of this profile's plan is used".
 *
 * Dispatches to the provider-specific fetcher and memoizes the snapshot for a
 * short TTL: the Claude OAuth endpoint is known to 429 under enthusiastic
 * polling, and the Codex answer only changes when a session runs anyway.
 */

import type { LLMProvider } from '@/shared/types.js';
import { resolveProfileDir } from '@/modules/profiles/profile-env.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';

import { fetchClaudeUsage } from './claude-usage-fetcher.js';
import { fetchCodexUsage } from './codex-usage-fetcher.js';
import type { FetchLike, ProfileUsageSnapshot } from './profile-usage.types.js';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  snapshot: ProfileUsageSnapshot;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const UNSUPPORTED_STATUS = 'unavailable' as const;

function unsupportedSnapshot(fetchedAt: string): ProfileUsageSnapshot {
  return {
    supported: false,
    status: UNSUPPORTED_STATUS,
    windows: [],
    plan: null,
    asOf: null,
    fetchedAt,
  };
}

async function fetchForProvider(
  provider: LLMProvider,
  profileDir: string,
  options: { fetchImpl?: FetchLike; now?: () => Date },
): Promise<ProfileUsageSnapshot> {
  switch (provider) {
    case 'claude':
      return fetchClaudeUsage(profileDir, options);
    case 'codex':
      return fetchCodexUsage(profileDir, options);
    case 'cursor':
    case 'opencode':
      // No known plan-usage source: cursor's store.db has no quota rows and
      // OpenCode fans out to arbitrary providers.
      return unsupportedSnapshot((options.now ?? (() => new Date()))().toISOString());
    default: {
      const unsupported: never = provider;
      throw new Error(`No usage fetcher for provider "${String(unsupported)}"`);
    }
  }
}

export const profileUsageService = {
  async getUsage(
    profileId: string,
    options: { fetchImpl?: FetchLike; now?: () => Date } = {},
  ): Promise<ProfileUsageSnapshot> {
    const now = options.now ?? (() => new Date());

    // Resolve first so an unknown id 404s instead of serving a stale entry.
    const profile = profilesService.getProfile(profileId);

    const cached = cache.get(profileId);
    if (cached && cached.expiresAt > now().getTime()) {
      return cached.snapshot;
    }

    const profileDir = resolveProfileDir(profile.provider, profile.slug);
    const snapshot = await fetchForProvider(profile.provider, profileDir, options);

    // Only cache real answers: a transient failure or logged-out state should
    // recover as soon as the user fixes it, not after a TTL.
    if (snapshot.status === 'ok' || !snapshot.supported) {
      cache.set(profileId, { snapshot, expiresAt: now().getTime() + CACHE_TTL_MS });
    }
    return snapshot;
  },

  /** Test hook — the cache is process-global. */
  clearCache(): void {
    cache.clear();
  },
};
