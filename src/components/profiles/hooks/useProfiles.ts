import { useCallback, useEffect, useMemo, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { LLMProvider } from '../../../types/app';
import type {
  CavemanMode,
  CreateProfileInput,
  Profile,
  ProfileAuthStatus,
  ProfileWithStatus,
  RtkMode,
} from '../types';

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: { message?: string } | string;
};

const getApiErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
};

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

async function fetchProfileList(): Promise<Profile[]> {
  const response = await authenticatedFetch('/api/profiles');
  const body = await toResponseJson<ApiEnvelope<{ profiles: Profile[] }>>(response);
  if (!response.ok || !body.success) {
    throw new Error(getApiErrorMessage(body, 'Failed to load profiles'));
  }
  return body.data?.profiles ?? [];
}

async function fetchProfileStatus(profileId: string): Promise<ProfileAuthStatus> {
  const response = await authenticatedFetch(`/api/profiles/${encodeURIComponent(profileId)}/status`);
  const body = await toResponseJson<ApiEnvelope<{ status: ProfileAuthStatus }>>(response);
  if (!response.ok || !body.success) {
    throw new Error(getApiErrorMessage(body, 'Failed to load profile status'));
  }
  return body.data?.status ?? { authenticated: false };
}

/**
 * Loads every account profile plus its auth status, and exposes create/delete.
 *
 * Status is a separate per-profile call (the list endpoint intentionally
 * stays cheap), so it is fetched in parallel right after the list resolves —
 * mirroring the "paint fast, enrich after" pattern used by `useMcpServers`.
 */
export function useProfiles() {
  const [profiles, setProfiles] = useState<ProfileWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const list = await fetchProfileList();
      setProfiles(list.map((profile) => ({ ...profile, status: null, statusLoading: true })));
      setIsLoading(false);

      await Promise.all(
        list.map(async (profile) => {
          try {
            const status = await fetchProfileStatus(profile.id);
            setProfiles((previous) => previous.map((entry) => (
              entry.id === profile.id ? { ...entry, status, statusLoading: false } : entry
            )));
          } catch {
            setProfiles((previous) => previous.map((entry) => (
              entry.id === profile.id ? { ...entry, statusLoading: false } : entry
            )));
          }
        }),
      );
    } catch (error) {
      setIsLoading(false);
      setLoadError(error instanceof Error ? error.message : 'Failed to load profiles');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProfile = useCallback(async (input: CreateProfileInput) => {
    setActionError(null);
    const response = await authenticatedFetch('/api/profiles', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    const body = await toResponseJson<ApiEnvelope<{ profile: Profile }>>(response);
    if (!response.ok || !body.success) {
      const message = getApiErrorMessage(body, 'Failed to create profile');
      setActionError(message);
      throw new Error(message);
    }

    await refresh();
  }, [refresh]);

  const deleteProfile = useCallback(async (profileId: string) => {
    setActionError(null);
    const response = await authenticatedFetch(`/api/profiles/${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
    });
    const body = await toResponseJson<ApiEnvelope<{ deleted: boolean }>>(response);
    if (!response.ok || !body.success) {
      const message = getApiErrorMessage(body, 'Failed to delete profile');
      setActionError(message);
      throw new Error(message);
    }

    await refresh();
  }, [refresh]);

  /**
   * Updates one profile's agent tooling levels.
   *
   * Only the keys passed are sent, so changing one level never resets the
   * other, and `null` clears a level back to unconfigured.
   */
  const updateToolingModes = useCallback(async (
    profileId: string,
    modes: { cavemanMode?: CavemanMode | null; rtkMode?: RtkMode | null },
  ) => {
    setActionError(null);
    const response = await authenticatedFetch(
      `/api/profiles/${encodeURIComponent(profileId)}/tooling`,
      { method: 'PATCH', body: JSON.stringify(modes) },
    );
    const body = await toResponseJson<ApiEnvelope<{ profile: Profile }>>(response);
    if (!response.ok || !body.success) {
      const message = getApiErrorMessage(body, 'Failed to update agent tooling');
      setActionError(message);
      throw new Error(message);
    }

    await refresh();
  }, [refresh]);

  const profilesByProvider = useMemo(() => {
    const grouped: Partial<Record<LLMProvider, ProfileWithStatus[]>> = {};
    profiles.forEach((profile) => {
      const bucket = grouped[profile.provider] ?? [];
      bucket.push(profile);
      grouped[profile.provider] = bucket;
    });
    return grouped;
  }, [profiles]);

  return {
    profiles,
    profilesByProvider,
    isLoading,
    loadError,
    actionError,
    refresh,
    createProfile,
    deleteProfile,
    updateToolingModes,
  };
}
