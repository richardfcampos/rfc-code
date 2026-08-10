import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { Profile, ProfileUsageSnapshot } from '../types';

import ProfileUsageMeterBody from './ProfileUsageMeterBody';

// Plan-limit usage for the account behind a profile (5h/weekly windows).
// Rendered only for providers with a usage source; degrades to a short note
// when the account is logged out or the source is unreachable.

async function fetchUsage(profileId: string): Promise<ProfileUsageSnapshot> {
  const response = await authenticatedFetch(`/api/profiles/${profileId}/usage`);
  const body = (await response.json()) as { success?: boolean; data?: { usage?: ProfileUsageSnapshot } };
  if (!response.ok || !body.success || !body.data?.usage) {
    throw new Error('Failed to load usage');
  }
  return body.data.usage;
}

export default function ProfileUsageMeter({ profile }: { profile: Profile }) {
  const [usage, setUsage] = useState<ProfileUsageSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setFailed(false);
    try {
      setUsage(await fetchUsage(profile.id));
    } catch {
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProfileUsageMeterBody
      snapshot={usage}
      provider={profile.provider}
      isLoading={isLoading}
      failed={failed}
      onRefresh={() => void load()}
    />
  );
}
