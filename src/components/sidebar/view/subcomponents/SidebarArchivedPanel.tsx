import { Archive, Folder, RotateCcw, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { ArchivedProjectListItem, ArchivedSessionListItem } from '../../types/types';
import {
  formatCompactArchivedAge,
  getArchivedSessionActivity,
  getArchivedSessionTitle,
  groupArchivedSessionsByProject,
} from '../../utils/archived-sessions';
import { getAllSessions } from '../../utils/utils';

export type SidebarArchivedPanelProps = {
  archivedProjects: ArchivedProjectListItem[];
  archivedSessions: ArchivedSessionListItem[];
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  onRestoreArchivedProject: (projectId: string) => void;
  onArchivedSessionClick: (session: ArchivedSessionListItem) => void;
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  t: TFunction;
};

const ACTION_BUTTON_CLASS =
  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-ctl transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-card bg-muted">
        <Archive className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mb-1 text-base font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default function SidebarArchivedPanel({
  archivedProjects,
  archivedSessions,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  onRestoreArchivedProject,
  onArchivedSessionClick,
  onRestoreArchivedSession,
  onDeleteArchivedSession,
  t,
}: SidebarArchivedPanelProps) {
  const groups = groupArchivedSessionsByProject(archivedSessions);

  if (isArchivedSessionsLoading) {
    return (
      <div className="px-4 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-card bg-muted">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
        <p className="text-sm text-muted-foreground">{t('archived.loadingTitle', 'Loading archive...')}</p>
      </div>
    );
  }

  if (archivedProjects.length === 0 && groups.length === 0) {
    return (
      <EmptyState
        title={archivedSessionsCount > 0
          ? t('archived.noMatchingSessions', 'No matching archived items')
          : t('archived.emptyTitle', 'No archived items')}
        description={archivedSessionsCount > 0
          ? t('archived.tryDifferentSearch', 'Try a different search term.')
          : t('archived.emptyDescription', 'Archived workspaces and sessions appear here once you hide them.')}
      />
    );
  }

  return (
    <div className="space-y-2 px-2 py-2">
      {archivedProjects.map((project) => (
        <div key={project.projectId} className="overflow-hidden rounded-card border border-border bg-card">
          <div className="flex items-start justify-between gap-2 border-b border-border px-2.5 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="truncate text-[13px] text-foreground">{project.displayName}</span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] tracking-wide text-faint" title={project.fullPath}>
                {project.fullPath}
              </p>
            </div>
            <button
              className={`${ACTION_BUTTON_CLASS} bg-success/10 text-success hover:bg-success/20`}
              onClick={() => onRestoreArchivedProject(project.projectId)}
              title={t('archived.restoreProject', 'Restore workspace')}
              aria-label={t('archived.restoreProject', 'Restore workspace')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="divide-y divide-border/50">
            {getAllSessions(project).map((session) => (
              <button
                key={String(session.id)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onArchivedSessionClick({
                  sessionId: String(session.id),
                  provider: session.__provider,
                  projectId: project.projectId,
                  projectPath: project.fullPath,
                  projectDisplayName: project.displayName,
                  sessionTitle: getArchivedSessionTitle(session),
                  createdAt: typeof session.created_at === 'string' ? session.created_at : null,
                  updatedAt: typeof session.updated_at === 'string' ? session.updated_at : null,
                  lastActivity: getArchivedSessionActivity(session),
                  isProjectArchived: true,
                })}
              >
                <SessionProviderLogo provider={session.__provider} className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                  {getArchivedSessionTitle(session)}
                </span>
                <span className="flex-shrink-0 font-mono text-[10px] tracking-wide text-faint">
                  {formatCompactArchivedAge(getArchivedSessionActivity(session))}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {groups.map((group) => (
        <div key={group.key} className="overflow-hidden rounded-card border border-border bg-card">
          <div className="flex items-start justify-between gap-2 border-b border-border px-2.5 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="truncate text-[13px] text-foreground">{group.projectDisplayName}</span>
              </div>
              {group.projectPath && (
                <p className="mt-0.5 truncate font-mono text-[10px] tracking-wide text-faint" title={group.projectPath}>
                  {group.projectPath}
                </p>
              )}
            </div>
            <span className="flex-shrink-0 font-mono text-[10px] tracking-wide text-faint">{group.sessions.length}</span>
          </div>
          <div className="divide-y divide-border/50">
            {group.sessions.map((session) => (
              <div key={session.sessionId} className="flex items-center gap-1 px-2.5 py-2">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onArchivedSessionClick(session)}
                >
                  <SessionProviderLogo provider={session.provider} className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{session.sessionTitle}</span>
                  {session.lastActivity && (
                    <span className="flex-shrink-0 font-mono text-[10px] tracking-wide text-faint">
                      {formatCompactArchivedAge(session.lastActivity)}
                    </span>
                  )}
                </button>
                <button
                  className={`${ACTION_BUTTON_CLASS} bg-success/10 text-success hover:bg-success/20`}
                  onClick={() => onRestoreArchivedSession(session.sessionId)}
                  title={t('archived.restore', 'Restore session')}
                  aria-label={t('archived.restore', 'Restore session')}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  className={`${ACTION_BUTTON_CLASS} bg-[var(--danger-tint)] text-danger hover:bg-danger/20`}
                  onClick={() => onDeleteArchivedSession(session)}
                  title={t('archived.deletePermanently', 'Delete permanently')}
                  aria-label={t('archived.deletePermanently', 'Delete permanently')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
