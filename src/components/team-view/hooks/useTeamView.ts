import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { TeamViewSnapshot } from '../types';

interface TeamViewApiResponse {
  success?: boolean;
  data?: TeamViewSnapshot;
}

const POLL_INTERVAL_MS = 5000;
const REFRESH_ON_KINDS = new Set(['task_update', 'agent_message_update']);

async function fetchTeamViewSnapshot(): Promise<TeamViewSnapshot> {
  const response = await authenticatedFetch('/api/team-view');
  const body = (await response.json()) as TeamViewApiResponse;
  if (!response.ok || !body.success || !body.data) {
    throw new Error('Failed to load team view');
  }
  return body.data;
}

const EMPTY_SNAPSHOT: TeamViewSnapshot = { sessions: [], edges: [] };

/**
 * Fetches the Team View aggregation and keeps it live: a 5s poll (mirrors the
 * running-sessions poll in `AppContent`) plus an immediate refetch whenever a
 * `task_update` or `agent_message_update` WS frame lands. Refetching the whole
 * snapshot on those events — rather than patching state locally — keeps this
 * hook simple and always consistent: the endpoint recomputes task/quota
 * matches server-side anyway, so a partial client-side merge would just be a
 * second, divergent copy of that logic.
 */
export function useTeamView() {
  const { subscribe } = useWebSocket();
  const [snapshot, setSnapshot] = useState<TeamViewSnapshot>(EMPTY_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current;
    setIsLoading(true);
    try {
      const loaded = await fetchTeamViewSnapshot();
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      setSnapshot(loaded);
      setLoadError(false);
    } catch {
      if (requestSeq === requestSeqRef.current) {
        setLoadError(true);
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => subscribe((event) => {
    if (typeof event.kind === 'string' && REFRESH_ON_KINDS.has(event.kind)) {
      void load();
    }
  }), [subscribe, load]);

  return { snapshot, isLoading, loadError, reload: load };
}
