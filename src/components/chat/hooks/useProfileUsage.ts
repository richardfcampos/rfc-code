import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { ProfileUsageSnapshot } from '../../profiles/types';

/**
 * Frontend mirror of the server's `ProfileUsageEnvelope` (batch route +
 * `profile_usage` WS event). The frontend keeps its own copy of server
 * contracts instead of importing server modules — same pattern as
 * `ProfileUsageSnapshot` in `components/profiles/types.ts`.
 */
export interface ProfileUsageEnvelope {
  profileId: string;
  state: 'cached' | 'pending';
  snapshot: ProfileUsageSnapshot | null;
  retryAt?: string;
}

interface UsageBatchResponse {
  success?: boolean;
  data?: { usage?: ProfileUsageEnvelope[] };
}

async function fetchUsageBatch(activeProfileId: string | null, force: boolean): Promise<ProfileUsageEnvelope[]> {
  const params = new URLSearchParams();
  if (force) {
    params.set('force', '1');
  }
  if (activeProfileId) {
    params.set('active', activeProfileId);
  }
  const query = params.toString();
  const response = await authenticatedFetch(`/api/profiles/usage${query ? `?${query}` : ''}`);
  const body = (await response.json()) as UsageBatchResponse;
  if (!response.ok || !body.success || !Array.isArray(body.data?.usage)) {
    throw new Error('Failed to load profile usage');
  }
  return body.data.usage;
}

// A `pending` envelope (no snapshot) never overwrites a row that already
// has real data — otherwise a late/lost WS event or an HTTP response that
// resolves after a stale WS `pending` would flip a displayed row back to a
// spinner forever. Once both sides carry a snapshot, the fresher
// `fetchedAt` wins; an event without a comparable `fetchedAt` (e.g. the
// first sighting of a profile) always applies.
const isFresherOrUnknown = (
  incoming: ProfileUsageEnvelope,
  existing: ProfileUsageEnvelope | undefined,
): boolean => {
  if (!incoming.snapshot) {
    return !existing?.snapshot;
  }
  const existingFetchedAt = existing?.snapshot?.fetchedAt;
  if (!existingFetchedAt) {
    return true;
  }
  return incoming.snapshot.fetchedAt >= existingFetchedAt;
};

/**
 * Batch plan-usage for the composer popover: one fetch on open/refresh, plus
 * late `profile_usage` WS updates while the popover stays open. No polling —
 * `enabled` toggles the WS subscription, so a closed popover simply never
 * receives late events (nothing to update, no error).
 */
export function useProfileUsage(enabled: boolean, activeProfileId: string | null) {
  const { subscribe } = useWebSocket();
  const [entries, setEntries] = useState<Record<string, ProfileUsageEnvelope>>({});
  // Row order as returned by the batch route (active profile first, grouped
  // by provider) — WS updates never reorder rows, only the HTTP fetch does.
  const [order, setOrder] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Bumped on every `load()` call so a response from a superseded call (slow
  // HTTP request overtaken by a newer one) can be dropped instead of
  // reordering rows or reverting entries with stale data.
  const requestSeqRef = useRef(0);

  const applyEnvelope = useCallback((envelope: ProfileUsageEnvelope) => {
    setEntries((previous) => {
      if (!isFresherOrUnknown(envelope, previous[envelope.profileId])) {
        return previous;
      }
      return { ...previous, [envelope.profileId]: envelope };
    });
  }, []);

  const load = useCallback(async (force = false) => {
    const requestSeq = ++requestSeqRef.current;
    setIsFetching(true);
    setLoadError(false);
    try {
      const usage = await fetchUsageBatch(activeProfileId, force);
      if (requestSeq !== requestSeqRef.current) {
        // A newer `load()` call started while this one was in flight —
        // discard this stale response.
        return;
      }
      setOrder(usage.map((envelope) => envelope.profileId));
      usage.forEach(applyEnvelope);
    } catch {
      if (requestSeq === requestSeqRef.current) {
        setLoadError(true);
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setIsFetching(false);
      }
    }
  }, [activeProfileId, applyEnvelope]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribe((event) => {
      if (event.kind !== 'profile_usage') {
        return;
      }
      const envelope = event.envelope as ProfileUsageEnvelope | undefined;
      if (!envelope || typeof envelope.profileId !== 'string') {
        return;
      }
      applyEnvelope(envelope);
    });
  }, [enabled, subscribe, applyEnvelope]);

  return { entries, order, isFetching, loadError, load };
}
