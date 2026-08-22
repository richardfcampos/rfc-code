import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../utils/api';

export type TaskPaletteAction = {
  id: string;
  label: string;
  run: () => Promise<void>;
};

const MIN_QUERY_LENGTH = 3;

/**
 * Palette contribution for the native task board: offers "Create task: <query>"
 * whenever the typed search is long enough to be a real title. Selecting it
 * posts straight to `/api/tasks` — the board's own `task_update` WS
 * subscription (see `useTaskBoard`) is what makes the new card show up, so
 * this hook does not keep any task list state of its own.
 */
export function useTaskActionsSource(projectId: string | undefined, query: string): TaskPaletteAction[] {
  const { t } = useTranslation('taskBoard');

  const createTask = useCallback(async (title: string) => {
    if (!projectId) {
      return;
    }
    const response = await authenticatedFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, project: projectId }),
    });
    if (!response.ok) {
      throw new Error('Failed to create task from the command palette');
    }
  }, [projectId]);

  return useMemo(() => {
    const trimmed = query.trim();
    if (!projectId || trimmed.length < MIN_QUERY_LENGTH) {
      return [];
    }

    return [
      {
        id: 'create-task',
        label: t('palette.createTask', { query: trimmed, defaultValue: `Create task: "${trimmed}"` }),
        run: () => createTask(trimmed),
      },
    ];
  }, [projectId, query, t, createTask]);
}
