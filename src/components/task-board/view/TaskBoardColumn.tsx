import { useTranslation } from 'react-i18next';

import type { Task, TaskStage } from '../types';
import type { TaskBoardColumnDef } from '../utils/taskBoardStages';

import TaskBoardCard from './TaskBoardCard';

type TaskBoardColumnProps = {
  column: TaskBoardColumnDef;
  tasks: Task[];
  onMove: (id: string, stage: TaskStage) => void;
  onDelete: (id: string) => void;
};

export default function TaskBoardColumn({ column, tasks, onMove, onDelete }: TaskBoardColumnProps) {
  const { t } = useTranslation('taskBoard');

  return (
    // Tablet-first mobile layout: columns stack vertically and scroll with the
    // page, each with its own sticky header. From `sm:` up they sit side by
    // side and each column scrolls independently instead.
    <div className="flex min-h-0 flex-col sm:h-full sm:w-72 sm:flex-shrink-0">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-card border border-border bg-muted/60 px-3 py-2 backdrop-blur sm:static sm:rounded-t-card">
        <h3 className="text-sm font-semibold text-foreground">
          {t(column.labelKey, { defaultValue: column.defaultLabel })}
        </h3>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      <div className="min-h-[80px] space-y-2 rounded-b-card border border-t-0 border-border bg-muted/20 p-2 sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {t('column.empty', { defaultValue: 'No tasks here yet.' })}
          </p>
        ) : (
          tasks.map((task) => (
            <TaskBoardCard key={task.id} task={task} onMove={onMove} onDelete={onDelete} />
          ))
        )}
      </div>
    </div>
  );
}
