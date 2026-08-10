// Split out of useCollaborations.ts to keep that file under the line budget —
// this hook has no coupling to the list/detail readers beyond shared fetch
// helpers, so it lives on its own.

import { useEffect, useState } from 'react';

import type { LLMProvider } from '../../../types/app';
import type { CollabProfileOption } from '../types';

import { requestJson, toMessage } from './collab-api';

// Providers that can take part in a collaboration: both run turns under a
// verified read-only sandbox, which is the safety bar the engine requires.
// Cursor and OpenCode have no equivalent, so their profiles stay out.
const COLLAB_PROVIDERS: readonly LLMProvider[] = ['claude', 'codex'];

const isCollabProvider = (provider: LLMProvider): boolean => COLLAB_PROVIDERS.includes(provider);

/**
 * Profiles offered as collaboration participants. The list endpoint filters by
 * a single provider at a time, so this asks for all of them and narrows here
 * instead of firing one request per provider.
 *
 * Authentication is not checked client-side: `/api/profiles` carries no auth
 * status (it needs a per-profile call) and the create endpoint rejects
 * unauthenticated participants with a message the modal surfaces.
 */
export function useClaudeProfiles(enabled: boolean) {
  const [profiles, setProfiles] = useState<CollabProfileOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;

    void (async () => {
      try {
        const data = await requestJson<{ profiles: CollabProfileOption[] }>(
          '/api/profiles', undefined, 'Failed to load profiles',
        );
        if (!cancelled) {
          setProfiles((data.profiles ?? []).filter((profile) => isCollabProvider(profile.provider)));
          setError(null);
        }
      } catch (loadFailure) {
        if (!cancelled) {
          setError(toMessage(loadFailure, 'Failed to load profiles'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { profiles, error };
}
