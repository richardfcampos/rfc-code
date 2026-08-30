import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type {
  ReviewComment,
  ReviewCommentRouting,
  ReviewDetail,
  ReviewMergeResult,
} from '../types';

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string } | string;
}

/** Reads the shared `{ success, data, error }` envelope, or throws its message. */
async function readEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.success || body.data === undefined) {
    const error = body.error;
    const message =
      typeof error === 'string' ? error : error?.message ?? 'The request failed';
    throw new Error(message);
  }
  return body.data;
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readEnvelope<T>(response);
}

/**
 * Loads one review (task, worktree coordinates, changed files, comments) and
 * exposes the actions the detail view offers. Diffs are fetched per file and
 * cached for the lifetime of the selection, since a diff for a given review is
 * immutable until the branch moves.
 */
export function useReviewDetail(reviewId: string | null) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const diffCacheRef = useRef(new Map<string, string>());
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!reviewId) {
      setDetail(null);
      setLoadError(null);
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await authenticatedFetch(`/api/reviews/${encodeURIComponent(reviewId)}`);
      const loaded = await readEnvelope<ReviewDetail>(response);
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      diffCacheRef.current = new Map();
      setDetail(loaded);
    } catch (error) {
      if (requestSeq === requestSeqRef.current) {
        setLoadError(error instanceof Error ? error.message : 'Failed to load the review');
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [reviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadFileDiff = useCallback(
    async (filePath: string): Promise<string> => {
      if (!reviewId) {
        return '';
      }
      const cached = diffCacheRef.current.get(filePath);
      if (cached !== undefined) {
        return cached;
      }

      const params = new URLSearchParams({ file: filePath });
      const response = await authenticatedFetch(
        `/api/reviews/${encodeURIComponent(reviewId)}/diff?${params.toString()}`,
      );
      const { diff } = await readEnvelope<{ diff: string }>(response);
      diffCacheRef.current.set(filePath, diff);
      return diff;
    },
    [reviewId],
  );

  const addComment = useCallback(
    async (input: { filePath: string; lineNo: number | null; body: string }) => {
      if (!reviewId) {
        throw new Error('No review selected');
      }
      const result = await post<{ comment: ReviewComment; routing: ReviewCommentRouting }>(
        `/api/reviews/${encodeURIComponent(reviewId)}/comments`,
        { filePath: input.filePath, lineNo: input.lineNo ?? undefined, body: input.body },
      );
      setDetail((previous) =>
        previous ? { ...previous, comments: [...previous.comments, result.comment] } : previous,
      );
      return result;
    },
    [reviewId],
  );

  const generateBrief = useCallback(async () => {
    if (!reviewId) {
      throw new Error('No review selected');
    }
    const result = await post<{ review: ReviewDetail['review'] }>(
      `/api/reviews/${encodeURIComponent(reviewId)}/brief`,
      {},
    );
    setDetail((previous) => (previous ? { ...previous, review: result.review } : previous));
    return result;
  }, [reviewId]);

  const approve = useCallback(
    async (options: { removeWorktree?: boolean } = {}) => {
      if (!reviewId) {
        throw new Error('No review selected');
      }
      return post<{ merge: ReviewMergeResult; taskUpdateError: string | null }>(
        `/api/reviews/${encodeURIComponent(reviewId)}/approve`,
        { removeWorktree: options.removeWorktree === true },
      );
    },
    [reviewId],
  );

  const requestChanges = useCallback(
    async (body: string) => {
      if (!reviewId) {
        throw new Error('No review selected');
      }
      const result = await post<{ routing: ReviewCommentRouting | null }>(
        `/api/reviews/${encodeURIComponent(reviewId)}/request-changes`,
        body.trim() ? { body: body.trim() } : {},
      );
      await load();
      return result;
    },
    [reviewId, load],
  );

  return {
    detail,
    isLoading,
    loadError,
    reload: load,
    loadFileDiff,
    addComment,
    generateBrief,
    approve,
    requestChanges,
  };
}
