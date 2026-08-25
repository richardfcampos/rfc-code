import { useEffect, useMemo, useRef, useState } from 'react';
import { KanbanSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/view/ui';
import type { Project } from '../../../types/app';
import { useTaskBoard } from '../hooks/useTaskBoard';
import { TASK_BOARD_COLUMNS } from '../utils/taskBoardStages';
import type { Task, TaskStage } from '../types';

import AutoPickupToggle from './AutoPickupToggle';
import TaskBoardColumn from './TaskBoardColumn';
import TaskDetailModal from './TaskDetailModal';

type TaskBoardTabProps = {
  selectedProject: Project | null;
};

function groupByStage(tasks: Task[]): Record<TaskStage, Task[]> {
  const grouped: Record<TaskStage, Task[]> = {
    backlog: [],
    in_progress: [],
    review: [],
    done: [],
  };
  for (const task of tasks) {
    grouped[task.stage].push(task);
  }
  return grouped;
}

export default function TaskBoardTab({ selectedProject }: TaskBoardTabProps) {
  const { t } = useTranslation('taskBoard');
  const projectId = selectedProject?.projectId;
  const { tasks, loadError, createTask, moveTask, deleteTask } = useTaskBoard(projectId);
  const [quickAddValue, setQuickAddValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);

  const tasksByStage = useMemo(() => groupByStage(tasks), [tasks]);

  // A project switch invalidates any open task id from the previous board.
  useEffect(() => {
    setOpenTaskId(null);
  }, [projectId]);

  if (!selectedProject) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <KanbanSquare className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t('emptyProject', { defaultValue: 'Select a project to see its task board.' })}
        </p>
      </div>
    );
  }

  const handleQuickAddSubmit = async () => {
    const title = quickAddValue.trim();
    if (!title || isCreating) {
      return;
    }
    setIsCreating(true);
    setQuickAddValue('');
    try {
      await createTask(title);
    } catch {
      // Optimistic entry already rolled back inside the hook; the input stays
      // cleared so the user can just retype without a blocking error dialog.
    } finally {
      setIsCreating(false);
      quickAddRef.current?.focus();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border p-3">
        <Input
          ref={quickAddRef}
          value={quickAddValue}
          onChange={(event) => setQuickAddValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleQuickAddSubmit();
            }
          }}
          disabled={isCreating}
          placeholder={t('quickAdd.placeholder', { defaultValue: 'New task — Enter creates it' })}
          aria-label={t('quickAdd.placeholder', { defaultValue: 'New task — Enter creates it' })}
          className="flex-1"
        />
        <AutoPickupToggle project={selectedProject} />
      </div>

      {loadError && (
        <div className="flex-shrink-0 border-b border-border bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('loadError', { defaultValue: 'Failed to load tasks. Try reloading the project.' })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:overflow-hidden">
        <div className="flex flex-col gap-3 sm:h-full sm:flex-row sm:items-stretch sm:overflow-x-auto sm:pb-1">
          {TASK_BOARD_COLUMNS.map((column) => (
            <TaskBoardColumn
              key={column.stage}
              column={column}
              tasks={tasksByStage[column.stage]}
              onMove={(id, stage) => void moveTask(id, stage)}
              onDelete={(id) => void deleteTask(id)}
              onOpen={setOpenTaskId}
            />
          ))}
        </div>
      </div>

      {openTaskId && (
        <TaskDetailModal
          taskId={openTaskId}
          onClose={() => setOpenTaskId(null)}
          onMoveStage={moveTask}
          onDeleteTask={deleteTask}
        />
      )}
    </div>
  );
}
