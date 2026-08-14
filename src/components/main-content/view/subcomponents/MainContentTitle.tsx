import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { SessionAccountSwitcher, SessionProfileBadge } from '../../../profiles';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import { getSessionWorktreeLabel } from '../../../sidebar/utils/utils';
import type { SessionNavigationOptions } from '../../../chat/types/types';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  /** Navigates to a seeded session once a cross-provider handoff creates one. */
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  /** Re-syncs the sidebar so a freshly seeded session shows up there. */
  onSessionsRefresh?: () => void;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  if (activeTab === 'collab') {
    return 'Collab';
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

/**
 * This title only renders below the 640px breakpoint (the header drops it
 * entirely at wider widths — see MainContentHeader), so its second line
 * doubles as the mobile worktree/message-count readout the desktop header
 * carries as a separate chip. Falls back to the project name when neither
 * value is available; never fabricates a count or branch.
 */
function getMobileSubtitle(session: ProjectSession, project: Project, t: TFunction): string {
  const worktreeLabel = getSessionWorktreeLabel(session);
  // The sessions endpoint does not count messages (it always sends 0), so a
  // zero here means "unknown", not "empty" — printing it would be a fabricated
  // number dressed up as data.
  const messageCount =
    typeof session.messageCount === 'number' && session.messageCount > 0 ? session.messageCount : null;

  const parts: string[] = [];
  if (worktreeLabel) {
    parts.push(`wt/${worktreeLabel}`);
  }
  if (messageCount !== null) {
    parts.push(`${messageCount} ${t('mainContent.msgsUnit', 'msgs')}`);
  }

  return parts.length > 0 ? parts.join(' · ') : project.displayName;
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  onNavigateToSession,
  onSessionsRefresh,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  return (
    // The provider logo, profile badge and account switcher below are the
    // sub-640px mount of HeaderSessionIdentity; the desktop header mounts that
    // component in its right cluster instead. Keep the two in sync.
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center">
              <h2 title={getSessionTitle(selectedSession)} className="truncate text-sm font-semibold leading-tight text-foreground">
                {getSessionTitle(selectedSession)}
              </h2>
              <SessionProfileBadge provider={selectedSession.__provider} profileId={selectedSession.profileId} />
              <SessionAccountSwitcher
                sessionId={selectedSession.id}
                provider={selectedSession.__provider}
                currentProfileId={selectedSession.profileId}
                onNavigateToSession={onNavigateToSession}
                onSessionsRefresh={onSessionsRefresh}
              />
            </div>
            <div className="truncate font-mono text-[11px] leading-tight tracking-wide text-muted-foreground">
              {getMobileSubtitle(selectedSession, selectedProject, t)}
            </div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        )}
      </div>
    </div>
  );
}
