// Data access for multi-account collaborations: the project's list, plus
// create/delete. Detail reading and the profile picker live in the sibling
// use-collaboration-detail.ts / use-claude-profiles.ts, re-exported below so
// existing imports keep working.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CollaborationSummary, CreateCollaborationInput } from '../types';
import { isTerminalStatus } from '../types';

import { collabUrl, requestJson, toMessage } from './collab-api';

const POLL_INTERVAL_MS = 3000;

/** Lists the collaborations of one project and exposes create/delete. */
export function useCollaborations(projectPath: string | null) {
  const [collaborations, setCollaborations] = useState<CollaborationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // `refresh` awaits a request that can outlive the panel (e.g. navigating to
  // the transcript unmounts this hook mid-flight) — guard state writes the
  // same way useClaudeProfiles does below.
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
      const data = await requestJson<{ collaborations: CollaborationSummary[] }>(
        `/api/collaborations${query}`, undefined, 'Failed to load collaborations',
      );
      if (isMountedRef.current) {
        setCollaborations(data.collaborations ?? []);
      }
    } catch (error) {
      if (isMountedRef.current) {
        setLoadError(toMessage(error, 'Failed to load collaborations'));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keeps status and round counts fresh for any collaboration still running,
  // so the list doesn't need a manual refresh to notice progress. Same
  // discipline as the detail poller: only ticks while needed, always cleared.
  const hasRunning = collaborations.some((collaboration) => !isTerminalStatus(collaboration.status));

  useEffect(() => {
    if (!hasRunning) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasRunning, refresh]);

  const createCollaboration = useCallback(async (input: CreateCollaborationInput) => {
    setActionError(null);
    try {
      const data = await requestJson<{ collaboration: CollaborationSummary }>(
        '/api/collaborations',
        { method: 'POST', body: JSON.stringify(input) },
        'Failed to start collaboration',
      );
      await refresh();
      return data.collaboration;
    } catch (error) {
      const message = toMessage(error, 'Failed to start collaboration');
      setActionError(message);
      throw new Error(message);
    }
  }, [refresh]);

  const deleteCollaboration = useCallback(async (collaborationId: string) => {
    setActionError(null);
    try {
      await requestJson<{ deleted: boolean }>(
        collabUrl(collaborationId), { method: 'DELETE' }, 'Failed to delete collaboration',
      );
      await refresh();
    } catch (error) {
      setActionError(toMessage(error, 'Failed to delete collaboration'));
    }
  }, [refresh]);

  return { collaborations, isLoading, loadError, actionError, refresh, createCollaboration, deleteCollaboration };
}

// Re-exported so existing `from '.../hooks/useCollaborations'` imports keep
// working — the implementations moved to sibling files to stay under this
// file's line budget.
export { useCollaborationDetail } from './use-collaboration-detail';
export { useClaudeProfiles } from './use-claude-profiles';
