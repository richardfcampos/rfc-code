// Options needed to open a chat session from a collaboration verdict: every
// account profile (any provider — the follow-up work does not have to run on
// the accounts that debated, and those are read-only by design) plus the model
// catalog of the provider currently picked.
//
// The requests go through the same envelope-unwrapping helper the other collab
// hooks use, so callers only ever see plain data or an Error.

import { useEffect, useState } from 'react';

import type { LLMProvider, ProviderModelOption, ProviderModelsDefinition } from '../../../types/app';
import type { CollabProfileOption } from '../types';

import { requestJson, toMessage } from './collab-api';

const PROFILES_ERROR = 'Failed to load account profiles';
const MODELS_ERROR = 'Failed to load models for this provider';

/** Every account profile, regardless of provider. */
export function useAllProfiles(enabled: boolean) {
  const [profiles, setProfiles] = useState<CollabProfileOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;

    void (async () => {
      try {
        const data = await requestJson<{ profiles?: CollabProfileOption[] }>(
          '/api/profiles', undefined, PROFILES_ERROR,
        );
        if (!cancelled) {
          setProfiles(data.profiles ?? []);
          setError(null);
        }
      } catch (loadFailure) {
        if (!cancelled) {
          setError(toMessage(loadFailure, PROFILES_ERROR));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { profiles, profilesError: error };
}

/**
 * Model catalog of a single provider. Deliberately a direct call to
 * `/api/providers/{provider}/models`: the chat composer's own loader
 * (`useChatProviderState`) fetches all four providers at once and owns state
 * this picker must not share, so reusing it here would mean instantiating a
 * second copy of the whole composer provider state.
 */
export function useProviderModelCatalog(provider: LLMProvider, enabled: boolean) {
  const [definition, setDefinition] = useState<ProviderModelsDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;

    setIsLoading(true);
    void (async () => {
      try {
        const data = await requestJson<{ models?: ProviderModelsDefinition }>(
          `/api/providers/${encodeURIComponent(provider)}/models`, undefined, MODELS_ERROR,
        );
        if (cancelled) {
          return;
        }
        setDefinition(data.models ?? null);
        setError(data.models ? null : MODELS_ERROR);
      } catch (loadFailure) {
        if (!cancelled) {
          setDefinition(null);
          setError(toMessage(loadFailure, MODELS_ERROR));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, provider]);

  const options: ProviderModelOption[] = definition?.OPTIONS ?? [];
  return { options, defaultModel: definition?.DEFAULT ?? '', modelsLoading: isLoading, modelsError: error };
}

/**
 * Allocates an empty session and returns its id. The first message is a
 * separate step (the composer's websocket send), which is exactly why the
 * verdict can be parked in the composer without anything being sent.
 */
export async function createProviderSession(input: {
  provider: LLMProvider;
  projectPath: string;
  profileId: string | null;
}): Promise<string> {
  const data = await requestJson<{ sessionId?: string }>(
    '/api/providers/sessions',
    {
      method: 'POST',
      body: JSON.stringify({
        provider: input.provider,
        projectPath: input.projectPath,
        profileId: input.profileId || undefined,
      }),
    },
    'Failed to start a new session',
  );

  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  if (!sessionId) {
    throw new Error('The session was created without an id, so it cannot be opened.');
  }

  return sessionId;
}
