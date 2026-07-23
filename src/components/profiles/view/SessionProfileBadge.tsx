import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';
import type { Profile } from '../types';

type SessionProfileBadgeProps = {
  provider?: LLMProvider | string;
  profileId?: string | null;
};

// Profile names rarely change mid-session; every session header for the same
// profile would otherwise refetch the same list identically.
const profileNameCache = new Map<string, string>();

/**
 * Reads `session.profileId` and shows which account profile a session is
 * bound to (HUB-05 AC2: "the session SHALL display which profile is in use").
 * Renders nothing for sessions without a profile (upstream default behavior).
 */
export default function SessionProfileBadge({ provider, profileId }: SessionProfileBadgeProps) {
  const [name, setName] = useState<string | null>(() => (
    profileId ? profileNameCache.get(profileId) ?? null : null
  ));

  useEffect(() => {
    if (!profileId) {
      setName(null);
      return undefined;
    }

    const cached = profileNameCache.get(profileId);
    if (cached) {
      setName(cached);
      return undefined;
    }

    let cancelled = false;
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';

    authenticatedFetch(`/api/profiles${query}`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled || !body?.success) {
          return;
        }

        const match = (body.data?.profiles as Profile[] | undefined)?.find(
          (profile) => profile.id === profileId,
        );
        if (match) {
          profileNameCache.set(profileId, match.name);
          setName(match.name);
        }
      })
      .catch((error) => {
        console.error('Error loading session profile badge:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [profileId, provider]);

  if (!profileId || !name) {
    return null;
  }

  return (
    <span
      title={name}
      className="ml-1.5 inline-flex max-w-[8rem] flex-shrink-0 items-center truncate rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-muted-foreground"
    >
      {name}
    </span>
  );
}
