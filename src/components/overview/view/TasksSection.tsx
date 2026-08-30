import type { OverviewTask } from '../utils/overview-data';

import TaskRow from './TaskRow';

type TasksSectionProps = {
  tasks: OverviewTask[];
  showDone?: boolean;
};

export default function TasksSection({ tasks, showDone = false }: TasksSectionProps) {
  const visibleTasks = showDone ? tasks : tasks.filter((task) => !task.isDone);

  if (visibleTasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks</p>;
  }

  return (
    <div className="grid gap-1.5">
      {visibleTasks.map((task) => (
        <TaskRow key={`${task.projectId}-${task.id}`} task={task} />
      ))}
    </div>
  );
}
