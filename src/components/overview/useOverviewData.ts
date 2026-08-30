import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Project } from '../../types/app';
import { api } from '../../utils/api';
import type { TaskMasterTask } from '../task-master/types';

import { buildOverviewData, type OverviewData, type OverviewRunningSession } from './utils/overview-data';

const RUNNING_POLL_INTERVAL_MS = 5_000;
const PROJECTS_POLL_INTERVAL_MS = 60_000;

type UseOverviewDataResult = OverviewData & {
  isLoading: boolean;
};

const parseRunningSession = (entry: unknown): OverviewRunningSession | null => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const record = entry as Record<string, unknown>;
  if (typeof record.sessionId !== 'string' || !record.sessionId) {
    return null;
  }

  return {
    sessionId: record.sessionId,
    needsAttention: record.needsAttention === true,
    statusText: typeof record.statusText === 'string' ? record.statusText : null,
  };
};

/**
 * Fetches one project's tasks, mapping every failure (network, 404, a project
 * without TaskMaster) to null so a single broken board never sinks the page.
 * A TaskMaster-less project answers 200 with a bare `tasks: []` and no
 * `tasksByStatus`; only the full board shape counts as "this project has one".
 */
const fetchProjectTasks = async (projectId: string): Promise<TaskMasterTask[] | null> => {
  try {
    const response = await api.taskmaster.getTasks(projectId);
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { tasks?: unknown; tasksByStatus?: unknown };
    if (!Array.isArray(payload.tasks) || !payload.tasksByStatus) {
      return null;
    }

    return payload.tasks as TaskMasterTask[];
  } catch {
    return null;
  }
};

/**
 * Data layer of the overview page: projects+tasks refresh every minute and on
 * window focus, the running feed polls every 5 seconds, and everything is
 * folded into view models by the pure `buildOverviewData` transform.
 */
export function useOverviewData(): UseOverviewDataResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksByProject, setTasksByProject] = useState<ReadonlyMap<string, TaskMasterTask[]>>(
    () => new Map(),
  );
  const [running, setRunning] = useState<OverviewRunningSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProjectsAndTasks = useCallback(async () => {
    try {
      const response = await api.projects();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as unknown;
      const projectList = Array.isArray(payload) ? (payload as Project[]) : [];

      const taskEntries = await Promise.all(
        projectList.map(async (project) => {
          const tasks = await fetchProjectTasks(project.projectId);
          return tasks === null ? null : ([project.projectId, tasks] as const);
        }),
      );

      // Committed together so a render never pairs new projects with old boards.
      setProjects(projectList);
      setTasksByProject(new Map(taskEntries.filter((entry) => entry !== null)));
    } catch (error) {
      console.error('[Overview] Failed to refresh projects and tasks:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshRunning = useCallback(async () => {
    try {
      const response = await api.runningSessions();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { data?: { sessions?: unknown } };
      const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];
      setRunning(sessions.map(parseRunningSession).filter((entry) => entry !== null));
    } catch (error) {
      console.error('[Overview] Failed to refresh running sessions:', error);
    }
  }, []);

  useEffect(() => {
    void refreshProjectsAndTasks();

    const interval = window.setInterval(() => {
      void refreshProjectsAndTasks();
    }, PROJECTS_POLL_INTERVAL_MS);

    const onFocus = () => {
      void refreshProjectsAndTasks();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshProjectsAndTasks]);

  useEffect(() => {
    void refreshRunning();

    const interval = window.setInterval(() => {
      void refreshRunning();
    }, RUNNING_POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [refreshRunning]);

  const data = useMemo(
    () => buildOverviewData({ projects, running, tasksByProject, now: new Date() }),
    [projects, running, tasksByProject],
  );

  return { ...data, isLoading };
}
