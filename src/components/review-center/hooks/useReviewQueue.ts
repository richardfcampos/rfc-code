import { useCallback, useEffect, useRef, useState } from 'react';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import { authenticatedFetch } from '../../../utils/api';
import type { ReviewQueueEntry } from '../types';

interface ReviewQueueResponse {
  success?: boolean;
  data?: { reviews?: ReviewQueueEntry[] };
}

/** States that keep a review in the queue; everything else drops out of it. */
const LIVE_STATES = new Set(['open', 'changes_requested']);

async function fetchQueue(projectId: string): Promise<ReviewQueueEntry[]> {
  const params = new URLSearchParams({ project: projectId });
  const response = await authenticatedFetch(`/api/reviews?${params.toString()}`);
  const body = (await response.json()) as ReviewQueueResponse;
  if (!response.ok || !body.success || !Array.isArray(body.data?.reviews)) {
    throw new Error('Failed to load reviews');
  }
  return body.data.reviews;
}

/**
 * Loads the review queue for the active project and keeps it live via the
 * `review_update` WS broadcast, so a review opened by an agent moving its own
 * card appears without a refresh. Mirrors `useTaskBoard`.
 */
export function useReviewQueue(projectId: string | undefined) {
  const { subscribe } = useWebSocket();
  const [reviews, setReviews] = useState<ReviewQueueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Bumped on every load so a superseded response (project switched mid-flight)
  // never overwrites the newer project's queue.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!projectId) {
      setReviews([]);
      setLoadError(false);
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      const loaded = await fetchQueue(projectId);
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      setReviews(loaded);
    } catch {
      if (requestSeq === requestSeqRef.current) {
        setLoadError(true);
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId) {
      return undefined;
    }

    return subscribe((event) => {
      if (event.kind !== 'review_update') {
        return;
      }
      const review = event.review as ReviewQueueEntry | undefined;
      if (!review || typeof review.review_id !== 'string') {
        return;
      }
      // The broadcast fans out to every client regardless of project.
      if (review.task_project_name !== projectId) {
        return;
      }

      setReviews((previous) => {
        const index = previous.findIndex((entry) => entry.review_id === review.review_id);
        if (!LIVE_STATES.has(review.state)) {
          return index === -1 ? previous : previous.filter((_, at) => at !== index);
        }
        if (index === -1) {
          return [review, ...previous];
        }
        if (review.updated_at < previous[index].updated_at) {
          return previous;
        }
        const next = [...previous];
        next[index] = review;
        return next;
      });
    });
  }, [projectId, subscribe]);

  return { reviews, isLoading, loadError, reload: load };
}
