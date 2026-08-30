import type { KeyboardEvent, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '../../../lib/utils';
import type { SidebarSessionStatus } from '../../sidebar/utils/session-status';
import type { OverviewTask } from '../utils/overview-data';

type TaskRowProps = {
  task: OverviewTask;
};

type StatusTone = {
  colorClassName: string;
  backgroundClassName: string;
  label: string;
};

// Centralized so the badge tint always matches the same status across the
// overview page, boards, and any future task surfaces reusing this mapping.
const getStatusTone = (task: OverviewTask): StatusTone => {
  if (task.isDone) {
    return { colorClassName: 'text-success', backgroundClassName: 'bg-success/10', label: 'done' };
  }

  if (task.status === 'in-progress') {
    return { colorClassName: 'text-primary', backgroundClassName: 'bg-primary/10', label: 'in progress' };
  }

  if (task.status === 'review') {
    return { colorClassName: 'text-review', backgroundClassName: 'bg-review/10', label: 'review' };
  }

  // 'pending' and any status TaskMaster adds later (cancelled, deferred, ...)
  // all read as neutral/muted rather than failing to render a tone.
  return {
    colorClassName: 'text-muted-foreground',
    backgroundClassName: 'bg-idle/20',
    label: task.status.replace(/-/g, ' '),
  };
};

type SessionPillTone = {
  dotClassName: string;
  label: string;
};

const SESSION_PILL_TONE_BY_STATUS: Record<SidebarSessionStatus, SessionPillTone> = {
  run: { dotClassName: 'animate-pulse bg-primary', label: 'session running' },
  attn: { dotClassName: 'bg-warning', label: 'needs you' },
  idle: { dotClassName: 'bg-idle', label: 'session idle' },
};

export default function TaskRow({ task }: TaskRowProps) {
  const navigate = useNavigate();
  const tone = getStatusTone(task);
  const sessionPillTone = task.linkedSession ? SESSION_PILL_TONE_BY_STATUS[task.linkedSession.status] : null;

  // The session pill opens a different route than the row it sits inside, so
  // it can't be a nested <a> (invalid HTML) — a span with link semantics plus
  // a guarded click/keydown handler gets the same behavior without that.
  const openSession = () => {
    if (!task.linkedSession) {
      return;
    }
    navigate(`/session/${task.linkedSession.id}`);
  };

  const handleSessionClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openSession();
  };

  const handleSessionKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openSession();
  };

  return (
    <a
      href={`/project/${task.projectId}?tab=tasks&task=${task.id}`}
      className="flex items-center gap-2.5 rounded-ctl border border-border bg-card px-3 py-2 text-[13px] transition-colors duration-150 ease-out hover:border-border-strong hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className="h-2 w-2 flex-shrink-0 rounded-[3px]"
        style={{ backgroundColor: task.accent.hue }}
        aria-hidden="true"
      />
      <span
        className="w-24 flex-shrink-0 truncate text-[11.5px] font-semibold"
        style={{ color: task.accent.hue }}
        title={task.projectName}
      >
        {task.projectName}
      </span>
      <span className="flex-shrink-0 font-mono text-[11px] text-muted-foreground">#{task.id}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={task.title}>
        {task.title}
      </span>

      {task.linkedSession && sessionPillTone && (
        <span
          role="link"
          tabIndex={0}
          onClick={handleSessionClick}
          onKeyDown={handleSessionKeyDown}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-full border border-border bg-[var(--hover)] px-2 py-0.5 text-[11px] text-muted-foreground transition-colors duration-150 ease-out hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', sessionPillTone.dotClassName)} aria-hidden="true" />
          {sessionPillTone.label}
        </span>
      )}

      <span
        className={cn(
          'flex-shrink-0 rounded-full px-2.5 py-0.5 text-center text-[10.5px] font-semibold uppercase tracking-wide',
          tone.backgroundClassName,
          tone.colorClassName,
        )}
      >
        {tone.label}
      </span>
    </a>
  );
}
