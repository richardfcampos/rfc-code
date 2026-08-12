import { useEffect, useRef } from 'react';
import { GitBranch } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';

import SidebarSessionRowActions from './SidebarSessionRowActions';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  needsAttention: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  t: TFunction;
};

/**
 * Compact relative time for sidebar rows:
 * <1m, Xm, Xhr, Xd.
 */
const formatCompactSessionAge = (dateString: string, currentTime: Date): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, currentTime.getTime() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) {
    return '<1m';
  }

  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}hr`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d`;
};

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  isProcessing,
  needsAttention,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const compactSessionAge = formatCompactSessionAge(sessionView.sessionTime, currentTime);
  const editingContainerRef = useRef<HTMLDivElement>(null);
  // Status dot semantics: waiting on the user (warning) takes priority over
  // running (primary, pulsing); everything else reads as idle.
  const dotStatus: 'attn' | 'run' | 'idle' = needsAttention ? 'attn' : isProcessing ? 'run' : 'idle';
  const dotLabel = dotStatus === 'attn'
    ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
    : dotStatus === 'run'
      ? t('tooltips.processingSessionIndicator', 'Processing session')
      : t('tooltips.idleSessionIndicator', { defaultValue: 'Idle session' });

  // The rename panel sits inside a group-hover opacity wrapper, so leaving the row
  // would visually hide it. While editing, dismiss only when the user clicks outside
  // the panel (matches Escape / cancel-button behaviour).
  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const container = editingContainerRef.current;
      if (container && !container.contains(event.target as Node)) {
        onCancelEditingSession();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEditing, onCancelEditingSession]);

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider);
  };

  return (
    <div className="group relative">
      <a
        href={`/session/${session.id}`}
        className={cn(
          'relative flex w-full items-start gap-2 rounded-ctl border py-1.5 pl-2.5 pr-2 text-left transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isSelected
            ? 'border-[var(--accent-line)] bg-[var(--accent-tint)]'
            : 'border-transparent hover:bg-[var(--hover)]',
        )}
        // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
        // native right-click menu use the href to open a new tab/window.
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          selectSession();
        }}
      >
        {isSelected && (
          <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-primary" aria-hidden="true" />
        )}

        <span
          // `img`, not `status`: this is a static per-row glyph, and a live
          // region on every row would make a 20-session list 20 live regions.
          role="img"
          aria-label={dotLabel}
          title={dotLabel}
          className={cn(
            'mt-[7px] block h-1.5 w-1.5 flex-shrink-0 rounded-full',
            dotStatus === 'attn' && 'bg-warning',
            dotStatus === 'run' && 'animate-pulse bg-primary',
            dotStatus === 'idle' && 'bg-idle',
          )}
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground">
              {sessionView.sessionName}
            </span>
            {compactSessionAge && (
              <span
                className={cn(
                  'flex-shrink-0 font-mono text-[11px] tracking-wide text-muted-foreground transition-opacity duration-150 ease-out',
                  isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                )}
              >
                {compactSessionAge}
              </span>
            )}
          </span>
          <span className="mt-px flex min-w-0 items-center gap-2">
            {/* The sessions list endpoint does not count messages, so a zero
                here means "unknown", not "empty" — printing it on every row
                would be noise dressed up as data. */}
            {Number(sessionView.messageCount) > 0 && (
              <span className="flex-shrink-0 font-mono text-[10px] tracking-wide text-muted-foreground">
                {sessionView.messageCount} {t('sessions.messageCountUnit', 'msgs')}
              </span>
            )}
            {needsAttention && (
              <span className="flex-shrink-0 rounded-ctl border border-[var(--warning-line)] px-1 font-mono text-[10px] tracking-wide text-warning">
                {t('sessions.permissionTag', 'permission')}
              </span>
            )}
            {sessionView.worktreeLabel && (
              <span
                className="flex min-w-0 items-center gap-1 rounded-ctl bg-[var(--hover)] px-1 font-mono text-[10px] tracking-wide text-muted-foreground"
                title={sessionView.worktreeLabel}
              >
                <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                <span className="truncate">wt/{sessionView.worktreeLabel}</span>
              </span>
            )}
          </span>
        </span>
      </a>

      <SidebarSessionRowActions
        ref={editingContainerRef}
        isEditing={isEditing}
        isProcessing={isProcessing}
        editingSessionName={editingSessionName}
        onEditingSessionNameChange={onEditingSessionNameChange}
        onStartEditing={() => onStartEditingSession(session.id, sessionView.sessionName)}
        onCancelEditing={onCancelEditingSession}
        onSave={saveEditedSession}
        onDelete={requestDeleteSession}
        t={t}
      />
    </div>
  );
}
