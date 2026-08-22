import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { Task } from '../types';

import { useTaskBoardMutations } from './useTaskBoardMutations';

interface TasksListResponse {
  success?: boolean;
  data?: { tasks?: Task[] };
}

async function fetchTasksForProject(projectId: string): Promise<Task[]> {
  const params = new URLSearchParams({ project: projectId });
  const response = await authenticatedFetch(`/api/tasks?${params.toString()}`);
  const body = (await response.json()) as TasksListResponse;
  if (!response.ok || !body.success || !Array.isArray(body.data?.tasks)) {
    throw new Error('Failed to load tasks');
  }
  return body.data.tasks;
}

function isTaskFreshOrUnknown(incoming: Task, existing: Task | undefined): boolean {
  if (!existing) {
    return true;
  }
  // Same string format on both sides (SQLite `CURRENT_TIMESTAMP`), so a plain
  // lexicographic comparison is a valid freshness check — mirrors the
  // `fetchedAt` guard in `useProfileUsage`.
  return incoming.updated_at >= existing.updated_at;
}

/**
 * Fetches the native task board for the active project and keeps it live via
 * the `task_update` WS broadcast (create/move/delete from any client, or from
 * the command palette / agent bridge, land here without polling).
 * Create/move/delete mutations live in `useTaskBoardMutations`.
 */
export function useTaskBoard(projectId: string | undefined) {
  const { subscribe } = useWebSocket();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Bumped on every `load()` so a response from a superseded call (project
  // switched mid-flight) never overwrites the newer project's tasks.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setLoadError(false);
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      const loaded = await fetchTasksForProject(projectId);
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      setTasks(loaded);
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
      if (event.kind !== 'task_update') {
        return;
      }
      const task = event.task as Task | undefined;
      const action = event.action as string | undefined;
      if (!task || typeof task.id !== 'string' || !action) {
        return;
      }
      // The broadcast fans out to every connected client regardless of
      // project — only apply events for the board currently on screen.
      if (task.project_name !== projectId) {
        return;
      }

      setTasks((previous) => {
        if (action === 'deleted') {
          return previous.filter((existing) => existing.id !== task.id);
        }

        const index = previous.findIndex((existing) => existing.id === task.id);
        if (index === -1) {
          return [task, ...previous];
        }
        if (!isTaskFreshOrUnknown(task, previous[index])) {
          return previous;
        }
        const next = [...previous];
        next[index] = task;
        return next;
      });
    });
  }, [projectId, subscribe]);

  const { createTask, moveTask, deleteTask } = useTaskBoardMutations(projectId, setTasks);

  return { tasks, isLoading, loadError, reload: load, createTask, moveTask, deleteTask };
}
