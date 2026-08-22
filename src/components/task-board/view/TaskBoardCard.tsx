import { ChevronLeft, ChevronRight, GitBranch, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { Button } from '../../../shared/view/ui';
import { SessionProfileBadge } from '../../profiles';
import { TASK_BOARD_COLUMNS, nextStage, previousStage } from '../utils/taskBoardStages';
import type { Task, TaskStage } from '../types';

import TaskOriginBadge from './TaskOriginBadge';

type TaskBoardCardProps = {
  task: Task;
  onMove: (id: string, stage: TaskStage) => void;
  onDelete: (id: string) => void;
};

export default function TaskBoardCard({ task, onMove, onDelete }: TaskBoardCardProps) {
  const { t } = useTranslation('taskBoard');
  const prev = previousStage(task.stage);
  const next = nextStage(task.stage);

  const handleDelete = () => {
    const confirmed = window.confirm(
      t('card.confirmDelete', { defaultValue: 'Delete this task?' }),
    );
    if (confirmed) {
      onDelete(task.id);
    }
  };

  return (
    <div className="group rounded-card border border-border bg-card p-3 shadow-sm transition-shadow duration-150 ease-out hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words text-sm font-medium leading-tight text-foreground">
          {task.title}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          title={t('card.delete', { defaultValue: 'Delete' })}
          aria-label={t('card.delete', { defaultValue: 'Delete' })}
          className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-danger sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TaskOriginBadge origin={task.origin} />
        {task.assignee_profile_id && <SessionProfileBadge profileId={task.assignee_profile_id} />}
        {task.worktree_branch && (
          <span
            title={`wt/${task.worktree_branch}`}
            className="inline-flex min-w-0 max-w-40 items-center gap-1 truncate rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-muted-foreground"
          >
            <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
            <span className="truncate">{task.worktree_branch}</span>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        {/* Desktop/tablet: hover-revealed arrow buttons move the task one
            stage at a time. No drag-and-drop dependency — matches the
            codebase's "no new DnD library" constraint. */}
        <div className="hidden items-center gap-1 sm:flex sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!prev}
            onClick={() => prev && onMove(task.id, prev)}
            title={t('card.movePrevious', { defaultValue: 'Move to previous column' })}
            aria-label={t('card.movePrevious', { defaultValue: 'Move to previous column' })}
            className="h-6 w-6"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!next}
            onClick={() => next && onMove(task.id, next)}
            title={t('card.moveNext', { defaultValue: 'Move to next column' })}
            aria-label={t('card.moveNext', { defaultValue: 'Move to next column' })}
            className="h-6 w-6"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Mobile/touch: hover has no equivalent, so the stage picker is a
            plain select that's always visible instead. */}
        <select
          value={task.stage}
          onChange={(event) => onMove(task.id, event.target.value as TaskStage)}
          aria-label={t('card.changeStage', { defaultValue: 'Change stage' })}
          className={cn(
            'h-7 rounded-ctl border border-input bg-card px-1.5 text-[11px] text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'sm:hidden',
          )}
        >
          {TASK_BOARD_COLUMNS.map((column) => (
            <option key={column.stage} value={column.stage}>
              {t(column.labelKey, { defaultValue: column.defaultLabel })}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
