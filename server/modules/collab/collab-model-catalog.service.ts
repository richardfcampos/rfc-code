/**
 * The model catalog a collaboration checks participant choices against.
 *
 * Reading it has to be synchronous: a collaboration is created synchronously,
 * before anything is persisted, while the catalog behind it is asynchronous —
 * Codex derives its list from a cache file the CLI maintains. So this keeps one
 * snapshot per provider, answers from it without awaiting, and refreshes in the
 * background.
 *
 * A provider whose snapshot has not landed yet answers `null` rather than an
 * empty list, and callers read `null` as "unknown" and skip the check. Rejecting
 * a model id we merely have not loaded is the one failure this gate must not
 * have: it would turn a cold snapshot into a 400 on a perfectly valid request.
 * The unchecked case degrades to what omitting a model already does — the CLI
 * settles the argument itself.
 *
 * The providers module is reached through a dynamic import of its barrel. The
 * validation rules that consume this are pure and tested with a fake catalog,
 * and a static import would drag the session watcher and the database into
 * those tests for a call they never make.
 */

import type { LLMProvider } from '@/shared/types.js';

export interface CollabModelOption {
  value: string;
  /** Effort values this model accepts; empty when it takes no effort override. */
  effortValues: string[];
}

export interface CollabModelCatalog {
  /** Options a provider currently offers, or `null` while none are known yet. */
  options(provider: LLMProvider): CollabModelOption[] | null;
}

/**
 * Long enough that a burst of requests costs one load, short enough that a
 * model list edited on disk reaches the next collaboration rather than the next
 * restart. Stale entries are still served while the refresh runs, so the delay
 * never lands on a request.
 */
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

interface Snapshot {
  options: CollabModelOption[];
  expiresAt: number;
}

const snapshots = new Map<LLMProvider, Snapshot>();
const inFlight = new Map<LLMProvider, Promise<void>>();

/** Installed by tests so validation runs against a catalog they control. */
let override: CollabModelCatalog | null = null;

async function loadSnapshot(provider: LLMProvider): Promise<void> {
  const { providerModelsService } = await import('@/modules/providers/index.js');
  const { models } = await providerModelsService.getProviderModels(provider);

  snapshots.set(provider, {
    options: models.OPTIONS.map((option) => ({
      value: option.value,
      effortValues: option.effort?.values.map((entry) => entry.value) ?? [],
    })),
    expiresAt: Date.now() + SNAPSHOT_TTL_MS,
  });
}

/**
 * Never rejects: this runs detached from the request that triggered it, and a
 * provider that cannot list its models leaves the snapshot as it was — stale,
 * or absent and therefore unchecked.
 */
function refresh(provider: LLMProvider): void {
  if (inFlight.has(provider)) return;

  const request = loadSnapshot(provider)
    .catch((error: unknown) => {
      console.error(`[collab] could not load the ${provider} model catalog:`, error);
    })
    .finally(() => {
      inFlight.delete(provider);
    });

  inFlight.set(provider, request);
}

const liveCatalog: CollabModelCatalog = {
  options(provider: LLMProvider): CollabModelOption[] | null {
    const snapshot = snapshots.get(provider);
    if (!snapshot || snapshot.expiresAt <= Date.now()) refresh(provider);
    return snapshot?.options ?? null;
  },
};

/** Replaces the live catalog; `null` restores it. */
export function configureCollabModelCatalog(catalog: CollabModelCatalog | null): void {
  override = catalog;
}

export const collabModelCatalog: CollabModelCatalog = {
  options: (provider) => (override ?? liveCatalog).options(provider),
};
