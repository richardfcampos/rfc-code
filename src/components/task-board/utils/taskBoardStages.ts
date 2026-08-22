import type { TaskStage } from '../types';
import { TASK_STAGES } from '../types';

export type TaskBoardColumnDef = {
  stage: TaskStage;
  labelKey: string;
  defaultLabel: string;
};

// Column order matches the board's stage progression and the server's own
// listing order (`tasksDb.listByProject`), so the grouped view never needs to
// re-sort on top of what the API already returns.
export const TASK_BOARD_COLUMNS: readonly TaskBoardColumnDef[] = [
  { stage: 'backlog', labelKey: 'columns.backlog', defaultLabel: 'Backlog' },
  { stage: 'in_progress', labelKey: 'columns.inProgress', defaultLabel: 'In progress' },
  { stage: 'review', labelKey: 'columns.review', defaultLabel: 'Review' },
  { stage: 'done', labelKey: 'columns.done', defaultLabel: 'Done' },
];

export function nextStage(stage: TaskStage): TaskStage | null {
  const index = TASK_STAGES.indexOf(stage);
  return index >= 0 && index < TASK_STAGES.length - 1 ? TASK_STAGES[index + 1] : null;
}

export function previousStage(stage: TaskStage): TaskStage | null {
  const index = TASK_STAGES.indexOf(stage);
  return index > 0 ? TASK_STAGES[index - 1] : null;
}
