import { useEffect, useRef } from 'react';
import { Check, Edit2, GitBranch, Loader2, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Badge, Tooltip, buttonVariants } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { createSessionViewModel } from '../../utils/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';

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
  const showAttentionIndicator = needsAttention && !isSelected;
  const showRecentIndicator = !showAttentionIndicator && !isProcessing && sessionView.isActive;
  // Status dot semantics: needs-permission (warning, solid) takes priority over
  // running (primary, pulsing) which takes priority over recently-active (success, solid).
  const dotStatus: 'attn' | 'run' | 'ok' | null = showAttentionIndicator
    ? 'attn'
    : isProcessing
      ? 'run'
      : showRecentIndicator
        ? 'ok'
        : null;

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
  const selectMobileSession = () => {
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
      {dotStatus && (
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 transform">
          <Tooltip
            content={dotStatus === 'attn'
              ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
              : dotStatus === 'run'
                ? t('tooltips.processingSessionIndicator', 'Processing session')
                : t('tooltips.activeSessionIndicator')}
            position="right"
          >
            <div
              role="status"
              aria-label={dotStatus === 'attn'
                ? t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })
                : dotStatus === 'run'
                  ? t('tooltips.processingSessionIndicator', 'Processing session')
                  : t('tooltips.activeSessionIndicator')}
              className={cn(
                'h-2 w-2 rounded-full',
                dotStatus === 'attn' && 'bg-warning',
                dotStatus === 'run' && 'animate-pulse bg-primary',
                dotStatus === 'ok' && 'bg-success',
              )}
            />
          </Tooltip>
        </div>
      )}

      <div className="md:hidden">
        <div
          className={cn(
            'p-2 mx-3 my-0.5 rounded-card bg-card border active:scale-[0.98] transition-colors duration-150 ease-out relative',
            isSelected ? 'bg-[var(--accent-tint)] border-[var(--accent-line)]' : '',
            !isSelected && isProcessing
              ? 'border-border bg-muted/20'
              : !isSelected && sessionView.isActive
              ? 'border-[var(--success-line)] bg-[var(--success-tint)]'
              : 'border-border/60',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'w-5 h-5 rounded-ctl flex items-center justify-center flex-shrink-0',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">{sessionView.sessionName}</div>
                {isProcessing ? (
                  <span className="ml-auto flex-shrink-0">
                    <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                      <span className="flex h-5 w-5 items-center justify-center rounded-ctl text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    </Tooltip>
                  </span>
                ) : compactSessionAge && (
                  <span className="ml-auto flex-shrink-0 font-mono text-[11px] tracking-wide text-muted-foreground">{compactSessionAge}</span>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1">
                {sessionView.messageCount > 0 && (
                  <Badge variant="secondary" className="flex-shrink-0 rounded-ctl px-1 py-0 font-mono text-[10px] tracking-wide">
                    {sessionView.messageCount}
                  </Badge>
                )}
                {sessionView.worktreeLabel && (
                  <Badge variant="secondary" className="min-w-0 gap-1 rounded-ctl px-1 py-0 font-mono text-[10px] font-normal tracking-wide">
                    <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                    <span className="truncate">{sessionView.worktreeLabel}</span>
                  </Badge>
                )}
              </div>
            </div>

            {!isProcessing && (
              <button
                className="ml-1 flex h-5 w-5 items-center justify-center rounded-ctl bg-[var(--danger-tint)] opacity-70 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
                onClick={(event) => {
                  event.stopPropagation();
                  requestDeleteSession();
                }}
              >
                <Trash2 className="h-2.5 w-2.5 text-danger" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <a
          href={`/session/${session.id}`}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'h-auto w-full justify-start rounded-card border bg-card p-2 text-left font-normal transition-colors duration-150 ease-out',
            isSelected ? 'border-[var(--accent-line)] bg-[var(--accent-tint)]' : 'border-border/40',
            !isSelected && isProcessing
              ? 'border-border bg-muted/20 hover:bg-muted/25'
              : !isSelected && sessionView.isActive
                ? 'border-[var(--success-line)] bg-[var(--success-tint)] hover:bg-[var(--success-tint)]'
                : 'hover:bg-accent/50',
          )}
          // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
          // native right-click menu use the href to open a new tab/window.
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSessionSelect(session, project.projectId);
          }}
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <div
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-ctl',
                isSelected ? 'bg-primary/10' : 'bg-muted/50',
              )}
            >
              <SessionProviderLogo provider={session.__provider} className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">{sessionView.sessionName}</div>
                {isProcessing ? (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 transition-opacity duration-150 ease-out',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
                      <span className="flex h-5 w-5 items-center justify-center rounded-ctl text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </span>
                    </Tooltip>
                  </span>
                ) : compactSessionAge && (
                  <span
                    className={cn(
                      'ml-auto flex-shrink-0 font-mono text-[11px] tracking-wide text-muted-foreground transition-opacity duration-150 ease-out',
                      isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                    )}
                  >
                    {compactSessionAge}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1">
                {sessionView.messageCount > 0 && <Badge variant="secondary" className="flex-shrink-0 rounded-ctl px-1 py-0 font-mono text-[10px] tracking-wide">{sessionView.messageCount}</Badge>}
                {sessionView.worktreeLabel && (
                  <Badge variant="secondary" className="min-w-0 gap-1 rounded-ctl px-1 py-0 font-mono text-[10px] font-normal tracking-wide">
                    <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                    <span className="truncate">{sessionView.worktreeLabel}</span>
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </a>

        <div
          ref={editingContainerRef}
          className={cn(
            'absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1 transition-opacity duration-150 ease-out',
            isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
            {isEditing ? (
              <>
                <input
                  type="text"
                  value={editingSessionName}
                  onChange={(event) => onEditingSessionNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      saveEditedSession();
                    } else if (event.key === 'Escape') {
                      onCancelEditingSession();
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="w-32 rounded-ctl border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-ctl bg-success/10 hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveEditedSession();
                  }}
                  title={t('tooltips.save')}
                >
                  <Check className="h-3 w-3 text-success" />
                </button>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-ctl bg-muted hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingSession();
                  }}
                  title={t('tooltips.cancel')}
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </>
            ) : (
              <>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-ctl bg-muted hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingSession(session.id, sessionView.sessionName);
                  }}
                  title={t('tooltips.editSessionName')}
                >
                  <Edit2 className="h-3 w-3 text-muted-foreground" />
                </button>
                {!isProcessing && (
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded-ctl bg-[var(--danger-tint)] hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDeleteSession();
                    }}
                    title={t('tooltips.deleteSessionOptions', 'Archive or permanently delete this session')}
                  >
                    <Trash2 className="h-3 w-3 text-danger" />
                  </button>
                )}
              </>
            )}
          </div>
      </div>
    </div>
  );
}
