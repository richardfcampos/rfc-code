import { useCallback, useEffect, useRef, useState } from 'react';

import type { Project } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';
import type { CompareTarget, GitCompareResponse, GitCompareResult, GitDiffMap, GitDiffResponse } from '../types/types';

type UseCompareControllerOptions = {
  selectedProject: Project | null;
  target: CompareTarget | null;
};

/**
 * Loads "what did this checkout change against <target>" for the Compare
 * view: the file list eagerly, each file's diff on demand.
 */
export function useCompareController({ selectedProject, target }: UseCompareControllerOptions) {
  const [result, setResult] = useState<GitCompareResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<GitDiffMap>({});
  // Bumped on every (project, target) change so late responses are dropped.
  const requestIdRef = useRef(0);

  const projectId = selectedProject?.projectId ?? null;
  const baseRef = target?.ref ?? null;

  const fetchCompare = useCallback(async () => {
    if (!projectId || !baseRef) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const response = await authenticatedFetch(
        `/api/git/compare?project=${encodeURIComponent(projectId)}&base=${encodeURIComponent(baseRef)}`,
      );
      const data = (await response.json()) as GitCompareResponse;
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (data.error || !data.files) {
        setResult(null);
        setError(data.error ?? 'Failed to compare');
        return;
      }

      setError(null);
      setResult({
        base: data.base ?? baseRef,
        mergeBase: data.mergeBase ?? '',
        ahead: data.ahead ?? 0,
        behind: data.behind ?? 0,
        files: data.files,
      });
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setResult(null);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to compare');
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [baseRef, projectId]);

  useEffect(() => {
    requestIdRef.current += 1;
    setResult(null);
    setDiffs({});
    setError(null);
    setIsLoading(false);
    void fetchCompare();
  }, [fetchCompare]);

  const fetchFileDiff = useCallback(
    async (filePath: string) => {
      if (!projectId || !baseRef) {
        return;
      }

      const requestId = requestIdRef.current;
      try {
        const response = await authenticatedFetch(
          `/api/git/compare-diff?project=${encodeURIComponent(projectId)}&base=${encodeURIComponent(baseRef)}&file=${encodeURIComponent(filePath)}`,
        );
        const data = (await response.json()) as GitDiffResponse;
        if (requestId !== requestIdRef.current) {
          return;
        }

        if (data.error) {
          console.error('Compare diff error:', data.error);
          return;
        }

        // An empty diff (pure rename) still marks the file as loaded.
        setDiffs((previous) => ({ ...previous, [filePath]: data.diff ?? '' }));
      } catch (fetchError) {
        console.error('Error fetching compare diff:', fetchError);
      }
    },
    [baseRef, projectId],
  );

  return { result, isLoading, error, diffs, refresh: fetchCompare, fetchFileDiff };
}
