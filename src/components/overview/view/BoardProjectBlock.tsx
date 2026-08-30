import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '../../../lib/utils';
import type { OverviewBoard, OverviewBoardColumn, OverviewBoardStatus } from '../utils/overview-data';

type BoardProjectBlockProps = {
  board: OverviewBoard;
  dimmedColumns?: Set<string> | null;
};

const COLUMN_LABELS: Record<OverviewBoardStatus, string> = {
  pending: 'Pending',
  'in-progress': 'In progress',
  review: 'Review',
  done: 'Done',
};

// Per-status Tailwind classes, spelled out rather than built from a template
// string — Tailwind only picks up class names it can see literally at build time.
const COLUMN_STYLES: Record<OverviewBoardStatus, { header: string; border: string }> = {
  pending: { header: 'text-muted-foreground', border: 'border-l-muted-foreground' },
  'in-progress': { header: 'text-primary', border: 'border-l-primary' },
  review: { header: 'text-review', border: 'border-l-review' },
  done: { header: 'text-success', border: 'border-l-success' },
};

const taskDetailHref = (projectId: string, taskId: string): string =>
  `/project/${projectId}?tab=tasks&task=${taskId}`;

// Ctrl/Cmd/Shift/Alt-click and native middle-click/context-menu should keep
// using the href (new tab, open in background); only a plain click intercepts
// for in-app SPA navigation.
const isPlainClick = (event: MouseEvent): boolean =>
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

export default function BoardProjectBlock({ board, dimmedColumns }: BoardProjectBlockProps) {
  const navigate = useNavigate();

  const totalTasks = board.columns.reduce((sum, column) => sum + column.count, 0);
  const reviewCount = board.columns.find((column) => column.status === 'review')?.count ?? 0;
  const boardHref = `/project/${board.projectId}?tab=tasks`;

  const openBoard = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate(boardHref);
  };

  return (
    <div className="rounded-card border border-border bg-card/50 p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
          style={{ backgroundColor: board.accent.hue }}
          aria-hidden="true"
        />
        <h3 className="truncate text-sm font-semibold text-foreground">{board.projectName}</h3>
        <span className="flex-shrink-0 text-xs text-muted-foreground">
          {totalTasks} {totalTasks === 1 ? 'task' : 'tasks'} · {reviewCount} in review
        </span>
        <a
          href={boardHref}
          onClick={openBoard}
          className="ml-auto flex-shrink-0 text-xs font-medium transition-opacity hover:underline hover:opacity-80"
          style={{ color: board.accent.hue }}
        >
          Open board →
        </a>
      </div>

      {/* 900px isn't a default Tailwind breakpoint; the mockup calls for the
          columns collapsing to 2-up earlier than `md` (768px). */}
      <div className="grid grid-cols-2 gap-2.5 min-[900px]:grid-cols-4">
        {board.columns.map((column) => (
          <BoardColumn
            key={column.status}
            projectId={board.projectId}
            column={column}
            dimmed={Boolean(dimmedColumns) && !dimmedColumns!.has(column.status)}
          />
        ))}
      </div>
    </div>
  );
}

function BoardColumn({
  projectId,
  column,
  dimmed,
}: {
  projectId: string;
  column: OverviewBoardColumn;
  dimmed: boolean;
}) {
  const navigate = useNavigate();
  const styles = COLUMN_STYLES[column.status];

  const openTask = (taskId: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate(taskDetailHref(projectId, taskId));
  };

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-background/55 p-2 transition-opacity duration-150',
        dimmed && 'opacity-25',
      )}
    >
      <div
        className={cn(
          'mb-2 flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide',
          styles.header,
        )}
      >
        <span>{COLUMN_LABELS[column.status]}</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">
          {column.count}
        </span>
      </div>

      {column.tasks.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {column.tasks.map((task) => {
            const taskId = String(task.id);
            return (
              <a
                key={taskId}
                href={taskDetailHref(projectId, taskId)}
                onClick={openTask(taskId)}
                className={cn(
                  'block truncate rounded-md border border-l-[3px] border-border bg-card px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:border-border-strong hover:bg-[var(--hover)]',
                  styles.border,
                )}
              >
                <span className="mr-1.5 text-[10.5px] text-muted-foreground">#{taskId}</span>
                {task.title}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
