import type { KeyboardEvent, MouseEvent } from 'react';
import { GitBranch } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { cn } from '../../../lib/utils';
import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import type { OverviewSession } from '../utils/overview-data';

type SessionCardProps = {
  session: OverviewSession;
};

const STATUS_LABEL: Record<OverviewSession['status'], string> = {
  run: 'Running',
  attn: 'Needs you',
  idle: 'Idle',
};

const STATUS_DOT_CLASS: Record<OverviewSession['status'], string> = {
  run: 'animate-pulse bg-primary',
  attn: 'bg-warning',
  idle: 'bg-idle',
};

const STATUS_TEXT_CLASS: Record<OverviewSession['status'], string> = {
  run: 'text-primary',
  attn: 'text-warning',
  idle: 'text-muted-foreground',
};

const isReviewTask = (status: string): boolean => status === 'review';
const isInProgressTask = (status: string): boolean => status === 'in-progress';

/**
 * Compact "Xh ago" label with no i18n dependency — the sidebar's relative-time
 * helpers all require a TFunction, which the overview page doesn't thread
 * through yet.
 */
function formatRelativeTime(dateString: string, nowMs: number): string {
  const timestamp = Date.parse(dateString);
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const diffMinutes = Math.floor(Math.max(0, nowMs - timestamp) / (60 * 1000));
  if (diffMinutes < 1) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function SessionCard({ session }: SessionCardProps) {
  const navigate = useNavigate();
  const { taskRef } = session;

  const statusLine = session.statusText
    ? `${STATUS_LABEL[session.status]} · ${session.statusText}`
    : STATUS_LABEL[session.status];

  // The task chip opens a different route than the card it sits inside, so it
  // can't be a nested <a> (invalid HTML) — a span with link semantics plus a
  // guarded click/keydown handler gets the same behavior without that.
  const openTask = () => {
    if (!taskRef) {
      return;
    }
    navigate(`/project/${session.projectId}?tab=tasks&task=${taskRef.id}`);
  };

  const handleTaskClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openTask();
  };

  const handleTaskKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openTask();
  };

  return (
    <a
      href={`/session/${session.id}`}
      className="hover:border-strong group relative block overflow-hidden rounded-card border border-border bg-card py-3.5 pl-5 pr-4 transition-all duration-150 ease-out hover:-translate-y-px hover:shadow-lg"
    >
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: session.accent.hue }}
        aria-hidden="true"
      />

      <div className="mb-1.5 flex items-center gap-2">
        <span className="truncate text-xs font-semibold" style={{ color: session.accent.hue }}>
          {session.projectName}
        </span>
        {session.worktreeLabel && (
          <span
            className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border bg-[var(--hover)] px-2 py-0.5 text-[11px] text-muted-foreground"
            title={session.worktreeLabel}
          >
            <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
            <span className="truncate">{session.worktreeLabel}</span>
          </span>
        )}
        <span className="ml-auto flex-shrink-0 text-muted-foreground">
          <SessionProviderLogo provider={session.provider} className="h-4 w-4" />
        </span>
      </div>

      <h3 className="mb-2 truncate text-[14.5px] font-semibold text-foreground">{session.title}</h3>

      <div className={cn('mb-2.5 flex items-center gap-2 text-[12.5px]', STATUS_TEXT_CLASS[session.status])}>
        <span
          className={cn('h-2 w-2 flex-shrink-0 rounded-full', STATUS_DOT_CLASS[session.status])}
          aria-hidden="true"
        />
        <span className="truncate">{statusLine}</span>
      </div>

      {taskRef && (
        <span
          role="link"
          tabIndex={0}
          onClick={handleTaskClick}
          onKeyDown={handleTaskKeyDown}
          className={cn(
            'mb-2.5 flex items-center gap-2 rounded-ctl border px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isReviewTask(taskRef.status) &&
              'border-review/35 bg-review/10 text-foreground hover:border-review hover:bg-review/15',
            isInProgressTask(taskRef.status) &&
              'border-primary/30 bg-primary/10 text-foreground hover:border-primary hover:bg-primary/15',
            !isReviewTask(taskRef.status) &&
              !isInProgressTask(taskRef.status) &&
              'border-border bg-[var(--hover)] text-foreground hover:border-strong',
          )}
        >
          <span
            className={cn(
              'flex-shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide',
              isReviewTask(taskRef.status) && 'bg-review/20 text-review',
              isInProgressTask(taskRef.status) && 'bg-primary/15 text-primary',
              !isReviewTask(taskRef.status) && !isInProgressTask(taskRef.status) && 'bg-muted text-muted-foreground',
            )}
          >
            Task
          </span>
          <span className="flex-shrink-0 text-muted-foreground">#{taskRef.id}</span>
          <span className="min-w-0 flex-1 truncate">{taskRef.title}</span>
          <span
            className={cn(
              'flex-shrink-0 text-[10.5px] font-semibold',
              isReviewTask(taskRef.status) && 'text-review',
              isInProgressTask(taskRef.status) && 'text-primary',
              !isReviewTask(taskRef.status) && !isInProgressTask(taskRef.status) && 'text-muted-foreground',
            )}
          >
            {taskRef.status}
          </span>
        </span>
      )}

      <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span>{formatRelativeTime(session.lastActivity, Date.now())}</span>
        <span
          className="opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
          style={{ color: session.accent.hue }}
        >
          Open chat →
        </span>
      </div>
    </a>
  );
}
