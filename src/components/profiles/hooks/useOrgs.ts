import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type {
  CreateOrgInput,
  CreateOrgRuleInput,
  Org,
  OrgProfilePolicy,
  OrgRule,
  UpdateOrgInput,
} from '../types';

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: { message?: string; code?: string } | string;
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

/**
 * Parses the server's `{success, data}` envelope, where `data` is the payload
 * itself (an org, a list, a policy array — never wrapped in a named key).
 *
 * Deletes reply `204 No Content` with no body at all, so parsing is skipped
 * for that status instead of calling `response.json()` on an empty stream
 * (which throws a `SyntaxError` and would turn a successful delete into a
 * thrown error).
 */
async function parseEnvelope<T>(response: Response, fallback: string): Promise<T> {
  if (response.status === 204) {
    if (!response.ok) {
      throw new Error(fallback);
    }
    return undefined as T;
  }

  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.success) {
    throw new Error(getApiErrorMessage(body, fallback));
  }
  return body.data as T;
}

/**
 * Loads every org (path/name rules + profile policies) and exposes CRUD for
 * orgs, their project rules, and their profile-policy list.
 *
 * Mirrors `useProfiles`: one `refresh()` after every mutation rather than
 * patching local state, since a single write here (e.g. deleting a rule) can
 * shift priorities across the whole policy list.
 */
export function useOrgs() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await authenticatedFetch('/api/orgs');
      const list = await parseEnvelope<Org[]>(response, 'Failed to load orgs');
      setOrgs(list ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load orgs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createOrg = useCallback(async (input: CreateOrgInput) => {
    setActionError(null);
    try {
      const response = await authenticatedFetch('/api/orgs', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await parseEnvelope<Org>(response, 'Failed to create org');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to create org');
      throw error;
    }

    await refresh();
  }, [refresh]);

  const updateOrg = useCallback(async (orgId: string, input: UpdateOrgInput) => {
    setActionError(null);
    try {
      const response = await authenticatedFetch(`/api/orgs/${encodeURIComponent(orgId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      await parseEnvelope<Org>(response, 'Failed to update org');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to update org');
      throw error;
    }

    await refresh();
  }, [refresh]);

  const deleteOrg = useCallback(async (orgId: string) => {
    setActionError(null);
    try {
      const response = await authenticatedFetch(`/api/orgs/${encodeURIComponent(orgId)}`, {
        method: 'DELETE',
      });
      await parseEnvelope<void>(response, 'Failed to delete org');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to delete org');
      throw error;
    }

    await refresh();
  }, [refresh]);

  const addRule = useCallback(async (orgId: string, input: CreateOrgRuleInput) => {
    setActionError(null);
    try {
      const response = await authenticatedFetch(`/api/orgs/${encodeURIComponent(orgId)}/rules`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await parseEnvelope<OrgRule>(response, 'Failed to add rule');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to add rule');
      throw error;
    }

    await refresh();
  }, [refresh]);

  const removeRule = useCallback(async (orgId: string, ruleId: string) => {
    setActionError(null);
    try {
      const response = await authenticatedFetch(
        `/api/orgs/${encodeURIComponent(orgId)}/rules/${encodeURIComponent(ruleId)}`,
        { method: 'DELETE' },
      );
      await parseEnvelope<void>(response, 'Failed to remove rule');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to remove rule');
      throw error;
    }

    await refresh();
  }, [refresh]);

  /** Replaces the org's full policy list — the PUT contract is not a merge. */
  const savePolicies = useCallback(async (orgId: string, policies: OrgProfilePolicy[]) => {
    setActionError(null);
    try {
      const response = await authenticatedFetch(`/api/orgs/${encodeURIComponent(orgId)}/policies`, {
        method: 'PUT',
        body: JSON.stringify(policies),
      });
      await parseEnvelope<OrgProfilePolicy[]>(response, 'Failed to save profile policies');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to save profile policies');
      throw error;
    }

    await refresh();
  }, [refresh]);

  return {
    orgs,
    isLoading,
    loadError,
    actionError,
    refresh,
    createOrg,
    updateOrg,
    deleteOrg,
    addRule,
    removeRule,
    savePolicies,
  };
}
