import { useCallback, useRef, useState } from 'react';

import type { Project } from '../../../types/app';

type UseOptimisticProjectToggleArgs = {
  projects: Project[];
  readFlag: (project: Project) => boolean;
  request: (projectId: string) => Promise<Response>;
  // Name of the boolean field the API response carries the new value under,
  // e.g. `notifyEnabled` for `{ success, notifyEnabled }`.
  responseKey: string;
  onError?: (message: string) => void;
};

type UseOptimisticProjectToggleResult = {
  isEnabled: (projectId: string) => boolean;
  toggle: (projectId: string) => void;
};

// Generic optimistic toggle for a per-project boolean flag (Map-based state,
// per-project sequence counter to drop stale responses, rollback on error).
// Mirrors `toggleStarProject` in useSidebarController.ts, generalised so the
// notify bell (and any future per-project toggle) doesn't need its own copy.
export function useOptimisticProjectToggle({
  projects,
  readFlag,
  request,
  responseKey,
  onError,
}: UseOptimisticProjectToggleArgs): UseOptimisticProjectToggleResult {
  const [optimisticByProjectId, setOptimisticByProjectId] = useState<Map<string, boolean>>(new Map());
  const sequenceByProjectRef = useRef<Map<string, number>>(new Map());

  const resolveState = useCallback(
    (projectId: string): boolean => {
      if (optimisticByProjectId.has(projectId)) {
        return Boolean(optimisticByProjectId.get(projectId));
      }

      const project = projects.find((candidate) => candidate.projectId === projectId);
      return project ? Boolean(readFlag(project)) : false;
    },
    [optimisticByProjectId, projects, readFlag],
  );

  const toggle = useCallback(
    (projectId: string) => {
      const previousState = resolveState(projectId);
      const optimisticState = !previousState;
      const latestSequence = (sequenceByProjectRef.current.get(projectId) ?? 0) + 1;
      sequenceByProjectRef.current.set(projectId, latestSequence);

      setOptimisticByProjectId((previous) => {
        const next = new Map(previous);
        next.set(projectId, optimisticState);
        return next;
      });

      const isLatestSequence = () => sequenceByProjectRef.current.get(projectId) === latestSequence;

      const run = async () => {
        try {
          const response = await request(projectId);
          if (!response.ok) {
            const payload = (await response.json()) as { error?: string | { message?: string } };
            const errorPayload = payload.error;
            const message =
              typeof errorPayload === 'string'
                ? errorPayload
                : errorPayload && typeof errorPayload === 'object' && errorPayload.message
                  ? errorPayload.message
                  : undefined;
            throw new Error(message);
          }

          const payload = (await response.json()) as Record<string, unknown>;
          if (!isLatestSequence()) {
            return;
          }

          setOptimisticByProjectId((previous) => {
            const next = new Map(previous);
            next.set(projectId, Boolean(payload[responseKey]));
            return next;
          });
        } catch (error) {
          if (!isLatestSequence()) {
            return;
          }

          setOptimisticByProjectId((previous) => {
            const next = new Map(previous);
            next.set(projectId, previousState);
            return next;
          });
          console.error('[Sidebar] Failed to toggle project flag:', error);
          const message = error instanceof Error && error.message ? error.message : undefined;
          onError?.(message ?? '');
        }
      };

      void run();
    },
    [onError, request, resolveState, responseKey],
  );

  return {
    isEnabled: resolveState,
    toggle,
  };
}
