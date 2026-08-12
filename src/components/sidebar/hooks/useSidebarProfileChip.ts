import { useEffect, useMemo, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { useProfileUsage } from '../../chat/hooks/useProfileUsage';
import type { Profile } from '../../profiles/types';

export type SidebarProfileChip = {
  id: string;
  name: string;
  initial: string;
  /** Highest plan-window utilization, or null while unknown/unsupported. */
  usagePercent: number | null;
};

type ProfileListResponse = {
  success?: boolean;
  data?: { profiles?: Profile[] };
};

/**
 * Footer account chip: the profile behind the open session plus its plan usage.
 *
 * The list endpoint is cheap and fetched once; usage reuses the composer's
 * `useProfileUsage` (cached batch route plus live `profile_usage` websocket
 * updates) so the sidebar never runs its own polling.
 */
export function useSidebarProfileChip(sessionProfileId: string | null | undefined): SidebarProfileChip | null {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadProfiles = async () => {
      try {
        const response = await authenticatedFetch('/api/profiles');
        const body = (await response.json()) as ProfileListResponse;
        if (!cancelled && response.ok && body.success && Array.isArray(body.data?.profiles)) {
          setProfiles(body.data.profiles);
        }
      } catch {
        // The chip is informational; a failed lookup simply hides it.
      }
    };

    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, []);

  // With a single account there is no ambiguity about whose plan is being
  // spent, so the chip still resolves before any session is opened.
  const profileId = sessionProfileId ?? (profiles.length === 1 ? profiles[0].id : null);
  const { entries, load } = useProfileUsage(Boolean(profileId), profileId);

  useEffect(() => {
    if (!profileId) {
      return;
    }
    void load();
  }, [load, profileId]);

  return useMemo(() => {
    if (!profileId) {
      return null;
    }

    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      return null;
    }

    const snapshot = entries[profileId]?.snapshot;
    const windows = snapshot && snapshot.supported && snapshot.status === 'ok' ? snapshot.windows : [];
    // The binding constraint is the window closest to its limit.
    const usagePercent = windows.length > 0
      ? Math.round(Math.max(...windows.map((window) => window.utilization)))
      : null;

    return {
      id: profile.id,
      name: profile.name,
      initial: (profile.name.trim()[0] ?? '?').toLowerCase(),
      usagePercent,
    };
  }, [entries, profileId, profiles]);
}
