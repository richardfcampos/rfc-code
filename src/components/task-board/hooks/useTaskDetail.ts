import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { TaskDetail } from '../types';
import { decideTaskDetailSync } from '../utils/taskDetailSync';

interface TaskDetailResponse {
  success?: boolean;
  data?: TaskDetail;
}

async function fetchTaskDetail(taskId: string): Promise<TaskDetail> {
  const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(taskId)}`);
  const body = (await response.json()) as TaskDetailResponse;
  if (!response.ok || !body.success || !body.data) {
    throw new Error('Failed to load task detail');
  }
  return body.data;
}

/**
 * Fetches one task's full detail (task + attachments + evidence) and keeps it
 * live via `task_update` WS frames — every attachment/evidence mutation from
 * any client (or the agent bridge / MCP tools) broadcasts the parent task, so
 * a matching frame always means "refetch" (see `decideTaskDetailSync`).
 */
export function useTaskDetail(taskId: string | undefined, onClosed: () => void) {
  const { subscribe } = useWebSocket();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const requestSeqRef = useRef(0);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const load = useCallback(async () => {
    if (!taskId) {
      setDetail(null);
      setLoadError(false);
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      const loaded = await fetchTaskDetail(taskId);
      if (requestSeq === requestSeqRef.current) {
        setDetail(loaded);
      }
    } catch {
      if (requestSeq === requestSeqRef.current) {
        setLoadError(true);
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!taskId) {
      return undefined;
    }

    return subscribe((event) => {
      const action = decideTaskDetailSync(event, taskId);
      if (action === 'refresh') {
        void load();
      } else if (action === 'close') {
        onClosedRef.current();
      }
    });
  }, [taskId, subscribe, load]);

  return { detail, isLoading, loadError, reload: load, setDetail };
}
