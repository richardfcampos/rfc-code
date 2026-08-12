import { useMemo } from 'react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import type { LLMProvider, LoadingProgress, Project, ProjectSession } from '../../../../types/app';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { SessionWithProvider } from '../../types/types';
import {
  collectRunningSessionEntries,
  collectSessionEntries,
  filterSessionEntries,
  groupSessionEntries,
  type SidebarSessionGroupKey,
} from '../../utils/session-groups';

import SidebarProjectsState from './SidebarProjectsState';
import SidebarSessionItem from './SidebarSessionItem';

export type SidebarSessionListProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  initialSessionsLoaded: Set<string>;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  sessionFilter: string;
  /** Running-only scope: sessions of every project that is currently working. */
  showRunningOnly: boolean;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectId: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  onDeleteSession: (projectId: string, sessionId: string, sessionTitle: string, provider: LLMProvider) => void;
  onLoadMoreSessions: (projectId: string) => void;
  t: TFunction;
};

const GROUP_LABELS: Record<SidebarSessionGroupKey, { key: string; fallback: string }> = {
  running: { key: 'groups.running', fallback: 'Running' },
  needsYou: { key: 'groups.needsYou', fallback: 'Needs you' },
  recent: { key: 'groups.recent', fallback: 'Recent' },
};

function SessionListSkeleton() {
  return (
    <div className="space-y-1 px-2 pt-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-start gap-2 rounded-ctl px-1 py-1.5">
          <div className="mt-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-1">
            <div className="h-3 animate-pulse rounded-ctl bg-muted" style={{ width: `${60 + index * 15}%` }} />
            <div className="h-2 w-1/3 animate-pulse rounded-ctl bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SidebarSessionGroups({
  projects,
  selectedProject,
  selectedSession,
  activeSessions,
  attentionSessionIds,
  isLoading,
  loadingProgress,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  sessionFilter,
  showRunningOnly,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  t,
}: SidebarSessionListProps) {
  const activeSessionIds = useMemo(() => new Set(activeSessions.keys()), [activeSessions]);

  const groups = useMemo(() => {
    const entries = showRunningOnly
      ? collectRunningSessionEntries(projects, activeSessionIds)
      : collectSessionEntries(projects, selectedProject);
    return groupSessionEntries(
      filterSessionEntries(entries, sessionFilter),
      activeSessionIds,
      attentionSessionIds,
    );
  }, [activeSessionIds, attentionSessionIds, projects, selectedProject, sessionFilter, showRunningOnly]);

  const sessionsAreLoaded = !selectedProject || initialSessionsLoaded.has(selectedProject.projectId);
  const hasMoreSessions = Boolean(selectedProject?.sessionMeta?.hasMore) && !showRunningOnly && !sessionFilter.trim();

  if (isLoading || projects.length === 0) {
    return (
      <SidebarProjectsState
        isLoading={isLoading}
        loadingProgress={loadingProgress}
        projectsCount={projects.length}
        filteredProjectsCount={projects.length}
        t={t}
      />
    );
  }

  if (!sessionsAreLoaded) {
    return <SessionListSkeleton />;
  }

  if (groups.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        {sessionFilter.trim()
          ? t('sessions.noMatchingSessions', 'No sessions match this filter.')
          : showRunningOnly
            ? t('running.emptyTitle', 'No sessions running')
            : t('sessions.noSessions')}
      </p>
    );
  }

  return (
    <div className="pb-2">
      {groups.map((group) => (
        <section key={group.key} className="mb-1">
          <div className="flex items-center justify-between px-2.5 pb-1 pt-2.5">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
              {t(GROUP_LABELS[group.key].key, GROUP_LABELS[group.key].fallback)}
            </h2>
            <span className="font-mono text-[10px] tracking-wide text-faint">{group.entries.length}</span>
          </div>
          <div className="space-y-0.5 px-1">
            {group.entries.map(({ project, session }) => (
              <SidebarSessionItem
                key={`${project.projectId}:${session.id}`}
                project={project}
                session={session}
                selectedSession={selectedSession}
                isProcessing={activeSessionIds.has(String(session.id))}
                needsAttention={group.key === 'needsYou'}
                currentTime={currentTime}
                editingSession={editingSession}
                editingSessionName={editingSessionName}
                onEditingSessionNameChange={onEditingSessionNameChange}
                onStartEditingSession={onStartEditingSession}
                onCancelEditingSession={onCancelEditingSession}
                onSaveEditingSession={onSaveEditingSession}
                onProjectSelect={(candidate) => {
                  if (candidate.projectId !== selectedProject?.projectId) {
                    onProjectSelect(candidate);
                  }
                }}
                onSessionSelect={onSessionSelect}
                onDeleteSession={onDeleteSession}
                t={t}
              />
            ))}
          </div>
        </section>
      ))}

      {hasMoreSessions && selectedProject && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-center rounded-ctl text-xs text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          onClick={() => onLoadMoreSessions(selectedProject.projectId)}
          disabled={isLoadingMoreSessions}
        >
          {isLoadingMoreSessions ? t('sessions.loadingSessions') : t('sessions.showMore')}
        </Button>
      )}
    </div>
  );
}
