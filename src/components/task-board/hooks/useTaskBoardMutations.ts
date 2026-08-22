import { useCallback, type Dispatch, type SetStateAction } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { Task, TaskStage } from '../types';

interface TaskMutationResponse {
  success?: boolean;
  data?: { task?: Task };
}

/**
 * Create/move/delete mutations for the task board, split out of
 * `useTaskBoard` to keep that hook focused on fetch + WS sync. Every mutation
 * applies optimistically against the shared `tasks` state and rolls back if
 * the request fails.
 */
export function useTaskBoardMutations(projectId: string | undefined, setTasks: Dispatch<SetStateAction<Task[]>>) {
  const createTask = useCallback(async (rawTitle: string) => {
    const title = rawTitle.trim();
    if (!projectId || !title) {
      return;
    }

    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const optimisticTask: Task = {
      id: optimisticId,
      project_name: projectId,
      title,
      description: null,
      stage: 'backlog',
      origin: 'user',
      origin_detail: null,
      assignee_profile_id: null,
      suggested_skill: null,
      worktree_branch: null,
      created_at: now,
      updated_at: now,
    };
    setTasks((previous) => [optimisticTask, ...previous]);

    try {
      const response = await authenticatedFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, project: projectId }),
      });
      const body = (await response.json()) as TaskMutationResponse;
      if (!response.ok || !body.success || !body.data?.task) {
        throw new Error('Failed to create task');
      }
      const created = body.data.task;

      setTasks((previous) => {
        const withoutOptimistic = previous.filter((existing) => existing.id !== optimisticId);
        // A racing `task_update` WS event may have already inserted the real
        // task (broadcast fires before the HTTP response is sent) — replace
        // rather than duplicate it in that case.
        const alreadyDelivered = withoutOptimistic.some((existing) => existing.id === created.id);
        if (alreadyDelivered) {
          return withoutOptimistic.map((existing) => (existing.id === created.id ? created : existing));
        }
        return [created, ...withoutOptimistic];
      });
    } catch (error) {
      setTasks((previous) => previous.filter((existing) => existing.id !== optimisticId));
      throw error;
    }
  }, [projectId, setTasks]);

  const moveTask = useCallback(async (id: string, stage: TaskStage) => {
    let previousStage: TaskStage | undefined;
    setTasks((previous) => previous.map((existing) => {
      if (existing.id !== id) {
        return existing;
      }
      previousStage = existing.stage;
      return { ...existing, stage };
    }));

    try {
      const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      });
      const body = (await response.json()) as TaskMutationResponse;
      if (!response.ok || !body.success || !body.data?.task) {
        throw new Error('Failed to move task');
      }
      const updated = body.data.task;
      setTasks((previous) => previous.map((existing) => (existing.id === id ? updated : existing)));
    } catch (error) {
      if (previousStage) {
        const revertStage = previousStage;
        setTasks((previous) => previous.map((existing) => (
          existing.id === id ? { ...existing, stage: revertStage } : existing
        )));
      }
      throw error;
    }
  }, [setTasks]);

  const deleteTask = useCallback(async (id: string) => {
    let removed: Task | undefined;
    setTasks((previous) => {
      removed = previous.find((existing) => existing.id === id);
      return previous.filter((existing) => existing.id !== id);
    });

    try {
      const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete task');
      }
    } catch (error) {
      if (removed) {
        const restored = removed;
        setTasks((previous) => [...previous, restored]);
      }
      throw error;
    }
  }, [setTasks]);

  return { createTask, moveTask, deleteTask };
}
