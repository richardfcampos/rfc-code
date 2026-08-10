/**
 * Application service answering "how much of this profile's plan is used".
 *
 * Dispatches to the provider-specific fetcher and memoizes the snapshot for a
 * short TTL: the Claude OAuth endpoint is known to 429 under enthusiastic
 * polling, and the Codex answer only changes when a session runs anyway.
 *
 * Also aggregates across every profile for the composer's usage popover
 * (`getAllUsage`), which adds three concerns the single-profile path does not
 * need: dedupe of concurrent fetches for the same profile, a negative cache so
 * a failing provider is not hammered every render, and a hard deadline so the
 * HTTP response never waits on a slow upstream — late answers are pushed out
 * through `setLateResultListener` instead.
 */

import type { LLMProvider } from '@/shared/types.js';
import { resolveProfileDir } from '@/modules/profiles/profile-env.js';
import { profilesService, type ProfileView } from '@/modules/profiles/profiles.service.js';

import { fetchClaudeUsage } from './claude-usage-fetcher.js';
import { fetchCodexUsage } from './codex-usage-fetcher.js';
import type {
  FetchLike,
  ProfileUsageEnvelope,
  ProfileUsageSnapshot,
} from './profile-usage.types.js';

const CACHE_TTL_MS = 60_000;
const NEGATIVE_CACHE_DEFAULT_MS = 15_000;
const MAX_CONCURRENT_FETCHES = 4;
const RENDER_DEADLINE_MS = 5_000;
const FORCE_THROTTLE_MS = 5_000;

/** Providers with a real plan-usage source; the only ones `getAllUsage` fans out to. */
const BATCH_PROVIDERS: readonly LLMProvider[] = ['claude', 'codex'];

interface CacheEntry {
  snapshot: ProfileUsageSnapshot;
  expiresAt: number;
}

interface NegativeCacheEntry {
  snapshot: ProfileUsageSnapshot;
  cooldownUntil: number;
}

type FetchOptions = { fetchImpl?: FetchLike; now?: () => Date };

const cache = new Map<string, CacheEntry>();
// Separate from `cache`: a real failure (not a login problem) should back off
// for a bit, but must never block a successful answer from landing, so it is
// never consulted by `getUsage` — only by the batch path below.
const negativeCache = new Map<string, NegativeCacheEntry>();
const inflight = new Map<string, Promise<ProfileUsageSnapshot>>();
const lastForcedFetchAt = new Map<string, number>();

let lateResultListener: ((envelope: ProfileUsageEnvelope) => void) | null = null;

// Global fetch concurrency, not per-provider: each profile owns its own
// credential/rate-limit bucket, so the cap only exists to avoid a burst of
// simultaneous outbound requests, not to protect a shared quota.
let activeSlots = 0;
const slotWaiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeSlots < MAX_CONCURRENT_FETCHES) {
    activeSlots += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    slotWaiters.push(resolve);
  });
}

function releaseSlot(): void {
  const next = slotWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeSlots = Math.max(0, activeSlots - 1);
}

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
  options: FetchOptions,
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

/**
 * Writes the outcome of a fetch to the right cache, or neither.
 *
 * `unauthenticated` is intentionally never cached — positive or negative — so
 * a profile that gets logged back in recovers on the very next look, not
 * after a TTL or cooldown.
 */
function writeCache(profileId: string, snapshot: ProfileUsageSnapshot, nowMs: number): void {
  if (snapshot.status === 'ok' || !snapshot.supported) {
    cache.set(profileId, { snapshot, expiresAt: nowMs + CACHE_TTL_MS });
    negativeCache.delete(profileId);
    return;
  }
  if (snapshot.status === 'unavailable') {
    // `!supported` already returned above, so this is a genuine claude/codex
    // failure — back off before hitting the source again.
    const cooldownMs =
      snapshot.reason === 'rate_limited' && snapshot.retryAfterMs !== undefined
        ? snapshot.retryAfterMs
        : NEGATIVE_CACHE_DEFAULT_MS;
    negativeCache.set(profileId, { snapshot, cooldownUntil: nowMs + cooldownMs });
  }
}

/**
 * Fetches through the concurrency semaphore, deduped by profile id.
 *
 * The map entry is set synchronously before the first await so that two
 * callers racing on the same profile — batch×batch or batch×`getUsage` — join
 * the same promise instead of firing two requests.
 */
function dedupedFetch(
  profileId: string,
  provider: LLMProvider,
  profileDir: string,
  options: FetchOptions,
): Promise<ProfileUsageSnapshot> {
  const existing = inflight.get(profileId);
  if (existing) {
    return existing;
  }

  const now = options.now ?? (() => new Date());
  const promise = (async () => {
    await acquireSlot();
    try {
      const snapshot = await fetchForProvider(provider, profileDir, options);
      writeCache(profileId, snapshot, now().getTime());
      return snapshot;
    } finally {
      releaseSlot();
    }
  })();

  inflight.set(profileId, promise);
  void promise.finally(() => {
    inflight.delete(profileId);
  });
  return promise;
}

function envelopeForSnapshot(profileId: string, snapshot: ProfileUsageSnapshot): ProfileUsageEnvelope {
  const envelope: ProfileUsageEnvelope = { profileId, state: 'cached', snapshot };
  if (snapshot.status === 'unavailable' && snapshot.reason === 'rate_limited') {
    const cooldownUntil = negativeCache.get(profileId)?.cooldownUntil;
    if (cooldownUntil !== undefined) {
      envelope.retryAt = new Date(cooldownUntil).toISOString();
    }
  }
  return envelope;
}

/** Active profile first, then grouped by provider (claude before codex). */
function orderCandidates(profiles: ProfileView[], activeProfileId?: string): ProfileView[] {
  const active = activeProfileId ? profiles.find((p) => p.id === activeProfileId) : undefined;
  const rest = active ? profiles.filter((p) => p.id !== active.id) : profiles;
  const grouped = [...rest].sort(
    (a, b) => BATCH_PROVIDERS.indexOf(a.provider) - BATCH_PROVIDERS.indexOf(b.provider),
  );
  return active ? [active, ...grouped] : grouped;
}

interface GetAllUsageOptions extends FetchOptions {
  activeProfileId?: string;
  force?: boolean;
}

export const profileUsageService = {
  async getUsage(
    profileId: string,
    options: FetchOptions = {},
  ): Promise<ProfileUsageSnapshot> {
    const now = options.now ?? (() => new Date());

    // Resolve first so an unknown id 404s instead of serving a stale entry.
    const profile = profilesService.getProfile(profileId);

    const cached = cache.get(profileId);
    if (cached && cached.expiresAt > now().getTime()) {
      return cached.snapshot;
    }

    const profileDir = resolveProfileDir(profile.provider, profile.slug);
    return dedupedFetch(profileId, profile.provider, profileDir, options);
  },

  /**
   * Aggregates usage across every claude/codex profile for the composer
   * popover. Returns within `RENDER_DEADLINE_MS` (5s): whichever fetches have
   * not settled by then come back `pending` and keep running in the
   * background — completion is reported via `setLateResultListener` instead
   * of blocking the response.
   */
  async getAllUsage(options: GetAllUsageOptions = {}): Promise<ProfileUsageEnvelope[]> {
    const now = options.now ?? (() => new Date());
    const force = options.force ?? false;
    const nowMs = now().getTime();

    const candidates = orderCandidates(
      profilesService.listProfiles().filter((p) => BATCH_PROVIDERS.includes(p.provider)),
      options.activeProfileId,
    );

    const envelopes: ProfileUsageEnvelope[] = new Array(candidates.length);
    const pending: Promise<void>[] = [];

    let deadline: Promise<void> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const ensureDeadline = (): Promise<void> => {
      if (!deadline) {
        deadline = new Promise<void>((resolve) => {
          deadlineTimer = setTimeout(resolve, RENDER_DEADLINE_MS);
        });
      }
      return deadline;
    };

    for (let index = 0; index < candidates.length; index += 1) {
      const profile = candidates[index]!;
      const id = profile.id;

      if (!force) {
        const successEntry = cache.get(id);
        if (successEntry && successEntry.expiresAt > nowMs) {
          envelopes[index] = envelopeForSnapshot(id, successEntry.snapshot);
          continue;
        }
        const negativeEntry = negativeCache.get(id);
        if (negativeEntry && negativeEntry.cooldownUntil > nowMs) {
          envelopes[index] = envelopeForSnapshot(id, negativeEntry.snapshot);
          continue;
        }
      } else {
        const negativeEntry = negativeCache.get(id);
        const isRateLimitedLockout =
          negativeEntry?.snapshot.reason === 'rate_limited' && negativeEntry.cooldownUntil > nowMs;
        if (isRateLimitedLockout) {
          envelopes[index] = envelopeForSnapshot(id, negativeEntry!.snapshot);
          continue;
        }

        const lastForced = lastForcedFetchAt.get(id);
        const throttled = lastForced !== undefined && nowMs - lastForced < FORCE_THROTTLE_MS;
        if (throttled) {
          const successEntry = cache.get(id);
          if (successEntry) {
            envelopes[index] = envelopeForSnapshot(id, successEntry.snapshot);
            continue;
          }
          if (negativeEntry) {
            envelopes[index] = envelopeForSnapshot(id, negativeEntry.snapshot);
            continue;
          }
          // Nothing cached yet (e.g. the last attempt was unauthenticated) —
          // fall through and fetch despite the throttle window.
        }
        lastForcedFetchAt.set(id, nowMs);
      }

      // Placeholder in case the deadline wins the race below.
      envelopes[index] = { profileId: id, state: 'pending', snapshot: null };

      const profileDir = resolveProfileDir(profile.provider, profile.slug);
      const fetchPromise = dedupedFetch(id, profile.provider, profileDir, options).then(
        (snapshot) => envelopeForSnapshot(id, snapshot),
      );

      pending.push(
        Promise.race([
          fetchPromise.then((envelope) => {
            envelopes[index] = envelope;
            return true as const;
          }),
          ensureDeadline().then(() => false as const),
        ]).then((settledBeforeDeadline) => {
          if (!settledBeforeDeadline) {
            // Deadline won — report the answer out-of-band whenever it lands.
            void fetchPromise.then((envelope) => {
              try {
                lateResultListener?.(envelope);
              } catch (error) {
                console.error('[profile-usage] late-result listener threw:', error);
              }
            });
          }
        }),
      );
    }

    await Promise.all(pending);
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }

    return envelopes;
  },

  /** Registers (or clears, with `null`) the callback for fetches that miss the render deadline. */
  setLateResultListener(listener: ((envelope: ProfileUsageEnvelope) => void) | null): void {
    lateResultListener = listener;
  },

  /** Test hook — the cache is process-global. */
  clearCache(): void {
    cache.clear();
    negativeCache.clear();
    inflight.clear();
    lastForcedFetchAt.clear();
    lateResultListener = null;
  },
};
