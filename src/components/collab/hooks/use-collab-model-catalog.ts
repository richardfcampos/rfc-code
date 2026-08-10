// Model catalogs for the providers a collaboration can actually seat.
//
// The composer reads the same endpoint, but through `useChatProviderState` —
// a hook that also owns the composer's own model, its effort, its localStorage
// mirrors and its per-session active-model reconciliation. None of that belongs
// in a create-collaboration modal, and there is no smaller hook to reuse, so
// this asks the same endpoint through the transport helper the other
// collaboration hooks already share.
//
// Only the providers actually on offer are fetched: a user with no Codex
// profile has no seat that could pick a Codex model, and no reason to pay for
// the request.

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { LLMProvider, ProviderModelOption, ProviderModelsDefinition } from '../../../types/app';

import { requestJson, toMessage } from './collab-api';

type Catalog = Partial<Record<LLMProvider, ProviderModelOption[]>>;

export interface CollabModelCatalog {
  /** Options a provider offers; empty until they load, or if loading failed. */
  optionsFor: (provider: LLMProvider) => ProviderModelOption[];
  loading: boolean;
  error: string | null;
}

const FAILED_TO_LOAD = 'Failed to load models';

export function useCollabModelCatalog(
  enabled: boolean,
  providers: readonly LLMProvider[],
): CollabModelCatalog {
  // A stable key: `providers` is rebuilt on every render, and depending on the
  // array itself would refetch the catalog on each keystroke in the modal.
  const key = useMemo(() => [...new Set(providers)].sort().join(','), [providers]);
  const [catalog, setCatalog] = useState<Catalog>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !key) {
      return undefined;
    }
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const wanted = key.split(',') as LLMProvider[];
      const results = await Promise.all(
        wanted.map(async (provider) => {
          try {
            const data = await requestJson<{ models: ProviderModelsDefinition }>(
              `/api/providers/${provider}/models`, undefined, FAILED_TO_LOAD,
            );
            return { provider, options: data.models?.OPTIONS ?? [], failure: null };
          } catch (loadFailure) {
            // One provider failing must not blank the others: that seat falls
            // back to its CLI default, and the modal says so rather than
            // offering a menu that silently lost half its entries.
            return { provider, options: [], failure: toMessage(loadFailure, FAILED_TO_LOAD) };
          }
        }),
      );
      if (cancelled) {
        return;
      }

      const next: Catalog = {};
      results.forEach((result) => {
        next[result.provider] = result.options;
      });
      const failed = results.filter((result) => result.failure !== null);

      setCatalog(next);
      setError(
        failed.length === 0
          ? null
          : `${FAILED_TO_LOAD} for ${failed.map((result) => result.provider).join(', ')}.`,
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  const optionsFor = useCallback(
    (provider: LLMProvider): ProviderModelOption[] => catalog[provider] ?? [],
    [catalog],
  );

  return { optionsFor, loading, error };
}
