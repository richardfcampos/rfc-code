// Split out of useCollaborations.ts to keep that file under the line budget.
// Reads one collaboration, polling every 3s while — and only while — it runs.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CollaborationDetail, CollaborationSummary } from '../types';

import { collabUrl, requestJson, toMessage } from './collab-api';

const POLL_INTERVAL_MS = 3000;
// The backend still records the turn that was in flight when Stop was pressed
// ("a paid turn is a recorded turn"), landing a moment after the stop response.
// One extra read past the poll cadence is enough to pick it up without turning
// this into a second polling loop.
const STOP_FOLLOWUP_DELAY_MS = 6000;

export function useCollaborationDetail(collaborationId: string | null) {
  const [collaboration, setCollaboration] = useState<CollaborationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  // Guards against responses landing after the view moved on or unmounted.
  const activeIdRef = useRef<string | null>(null);
  // Holds the one-shot "pick up the in-flight turn" timer scheduled by stop().
  const followUpTimerRef = useRef<number | null>(null);

  const clearFollowUpTimer = useCallback(() => {
    if (followUpTimerRef.current !== null) {
      window.clearTimeout(followUpTimerRef.current);
      followUpTimerRef.current = null;
    }
  }, []);

  const fetchDetail = useCallback(async () => {
    if (!collaborationId) {
      return;
    }
    try {
      const data = await requestJson<{ collaboration: CollaborationDetail }>(
        collabUrl(collaborationId), undefined, 'Failed to load collaboration',
      );
      if (activeIdRef.current === collaborationId) {
        setCollaboration(data.collaboration);
        setLoadError(null);
      }
    } catch (error) {
      if (activeIdRef.current === collaborationId) {
        setLoadError(toMessage(error, 'Failed to load collaboration'));
      }
    }
  }, [collaborationId]);

  useEffect(() => {
    activeIdRef.current = collaborationId;
    setCollaboration(null);
    setLoadError(null);
    void fetchDetail();
    return () => {
      activeIdRef.current = null;
      // Viewed id changed (or we unmounted): a pending follow-up read would
      // otherwise land against whatever is now on screen.
      clearFollowUpTimer();
    };
  }, [collaborationId, fetchDetail, clearFollowUpTimer]);

  const isRunning = collaboration?.status === 'running';

  useEffect(() => {
    if (!collaborationId || !isRunning) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void fetchDetail();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [collaborationId, isRunning, fetchDetail]);

  const stop = useCallback(async () => {
    if (!collaborationId) {
      return;
    }
    setIsStopping(true);
    try {
      const data = await requestJson<{ collaboration: CollaborationSummary }>(
        collabUrl(collaborationId, '/stop'), { method: 'POST' }, 'Failed to stop collaboration',
      );
      if (activeIdRef.current === collaborationId) {
        // Merge instead of replace: the stop response carries no turns.
        setCollaboration((previous) => (previous ? { ...previous, ...data.collaboration } : previous));
        // The status is now terminal, so the polling effect above has already
        // stopped — this is a single extra read, not a restart of that loop.
        const targetId = collaborationId;
        clearFollowUpTimer();
        followUpTimerRef.current = window.setTimeout(() => {
          followUpTimerRef.current = null;
          if (activeIdRef.current === targetId) {
            void fetchDetail();
          }
        }, STOP_FOLLOWUP_DELAY_MS);
      }
    } catch (error) {
      setLoadError(toMessage(error, 'Failed to stop collaboration'));
    } finally {
      setIsStopping(false);
    }
  }, [collaborationId, fetchDetail, clearFollowUpTimer]);

  const isLoading = Boolean(collaborationId) && !collaboration && !loadError;

  return { collaboration, isLoading, loadError, isStopping, stop, refresh: fetchDetail };
}
