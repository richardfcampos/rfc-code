import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useVersionCheck } from '../../../hooks/useVersionCheck';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useNewSessionShortcut } from '../hooks/useNewSessionShortcut';
import { useSidebarController } from '../hooks/useSidebarController';
import { useSidebarProfileChip } from '../hooks/useSidebarProfileChip';
import { useSidebarRailViewport } from '../hooks/useSidebarRailViewport';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import type { Project, LLMProvider } from '../../../types/app';
import type { MCPServerStatus, SidebarProps } from '../types/types';
import { collectSessionEntries, sessionNeedsUser } from '../utils/session-groups';
import { getSessionName } from '../utils/utils';

import SidebarCollapsed, { type SidebarRailSession } from './subcomponents/SidebarCollapsed';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
  mcpServerStatus: MCPServerStatus;
};

function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  activeSessions,
  attentionSessionIds,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { updateAvailable, restartRequired, latestVersion, currentVersion, releaseInfo, installMode } = useVersionCheck(
    'siteboon',
    'claudecodeui',
  );
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject, mcpServerStatus } = useTaskMaster() as TaskMasterSidebarContext;
  const { tasksEnabled } = useTasksSettings();
  const paletteOps = usePaletteOps();
  const profile = useSidebarProfileChip(selectedSession?.profileId ?? null);

  const {
    isSidebarCollapsed,
    editingProject,
    showNewProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults,
    runningSessionsCount,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    sortedProjects,
    archivedProjects,
    archivedSessions,
    archivedSessionsCount,
    isArchivedSessionsLoading,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    loadingMoreProjects,
    loadMoreSessionsForProject,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    handleProjectSelect,
    openArchivedSession,
    restoreArchivedProject,
    restoreArchivedSession,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    activeSessions,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onLoadMoreSessions,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  // Tablet widths default to the icon rail; the user can still open the full
  // sidebar from the rail for as long as the viewport stays in that band. Wider
  // viewports keep obeying the persisted collapse preference.
  const isRailViewport = useSidebarRailViewport();
  const [isRailOpenedOnTablet, setIsRailOpenedOnTablet] = useState(false);

  useEffect(() => {
    if (!isRailViewport) {
      setIsRailOpenedOnTablet(false);
    }
  }, [isRailViewport]);

  const showRail = isRailViewport ? !isRailOpenedOnTablet : isSidebarCollapsed;

  const expandFromRail = useCallback(() => {
    if (isRailViewport) {
      setIsRailOpenedOnTablet(true);
      return;
    }
    handleExpandSidebar();
  }, [handleExpandSidebar, isRailViewport]);

  const collapseToRail = useCallback(() => {
    if (isRailViewport) {
      setIsRailOpenedOnTablet(false);
      return;
    }
    handleCollapseSidebar();
  }, [handleCollapseSidebar, isRailViewport]);

  const handleProjectCreated = () => {
    void paletteOps.refreshProjects();
  };

  const handleNewSession = useCallback(() => {
    if (selectedProject) {
      onNewSession(selectedProject);
    }
  }, [onNewSession, selectedProject]);

  useNewSessionShortcut(Boolean(selectedProject), handleNewSession);

  // Rail entries: every session that is working or waiting on the user, across
  // projects — the same population the RUNNING and NEEDS YOU groups render.
  const railSessions = useMemo<SidebarRailSession[]>(() => {
    const activeSessionIds = new Set(activeSessions.keys());

    return collectSessionEntries(projects, null)
      .filter(({ session }) => {
        const sessionId = String(session.id);
        return activeSessionIds.has(sessionId) || sessionNeedsUser(sessionId, attentionSessionIds);
      })
      .map(({ project, session }) => {
        const sessionId = String(session.id);
        return {
          id: `${project.projectId}:${sessionId}`,
          title: getSessionName(session, t),
          status: sessionNeedsUser(sessionId, attentionSessionIds) ? 'attn' : 'run',
          isSelected: selectedSession?.id === session.id,
          onSelect: () => {
            if (project.projectId !== selectedProject?.projectId) {
              handleProjectSelect(project);
            }
            handleSessionClick(session, project.projectId);
          },
        } satisfies SidebarRailSession;
      });
  }, [
    activeSessions,
    attentionSessionIds,
    handleProjectSelect,
    handleSessionClick,
    projects,
    selectedProject,
    selectedSession,
    t,
  ]);

  return (
    <>
      <SidebarModals
        projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        showVersionModal={showVersionModal}
        onCloseVersionModal={() => setShowVersionModal(false)}
        releaseInfo={releaseInfo}
        currentVersion={currentVersion}
        latestVersion={latestVersion}
        installMode={installMode}
        t={t}
      />

      {showRail ? (
        <SidebarCollapsed
          onExpand={expandFromRail}
          onNewSession={handleNewSession}
          canCreateSession={Boolean(selectedProject)}
          railSessions={railSessions}
          profile={profile}
          onShowSettings={onShowSettings}
          updateAvailable={updateAvailable}
          restartRequired={restartRequired}
          onShowVersionModal={() => setShowVersionModal(true)}
          t={t}
        />
      ) : (
        <SidebarContent
          isPWA={isPWA}
          isMobile={isMobile}
          searchFilter={searchFilter}
          onSearchFilterChange={setSearchFilter}
          onClearSearchFilter={() => setSearchFilter('')}
          searchMode={searchMode}
          onSearchModeChange={(mode) => {
            setSearchMode(mode);
            if (mode !== 'conversations') clearConversationResults();
          }}
          runningSessionsCount={runningSessionsCount}
          conversationResults={conversationResults}
          isSearching={isSearching}
          searchProgress={searchProgress}
          onConversationResultClick={(projectId, sessionId, provider, messageTimestamp, messageSnippet) => {
            // `projectId` (DB key) is the canonical identifier post-migration.
            // The server emits null when it can't resolve a project row for
            // the search hit; treat that as "no project" and still navigate
            // to the session so the user can open it from the URL.
            const resolvedProvider = (provider || 'claude') as LLMProvider;
            const project = projectId ? projects.find((candidate) => candidate.projectId === projectId) : null;
            const searchTarget = {
              __searchTargetTimestamp: messageTimestamp || null,
              __searchTargetSnippet: messageSnippet || null,
            };
            const sessionObj = {
              id: sessionId,
              __provider: resolvedProvider,
              __projectId: projectId ?? undefined,
              ...searchTarget,
            };
            if (project) {
              handleProjectSelect(project);
              const existing = getProjectSessions(project).find((session) => session.id === sessionId);
              handleSessionClick(existing ? { ...existing, ...searchTarget } : sessionObj, project.projectId);
            } else {
              handleSessionClick(sessionObj, projectId ?? '');
            }
          }}
          archivedPanelProps={{
            archivedProjects,
            archivedSessions,
            archivedSessionsCount,
            isArchivedSessionsLoading,
            onRestoreArchivedProject: restoreArchivedProject,
            onArchivedSessionClick: openArchivedSession,
            onRestoreArchivedSession: restoreArchivedSession,
            onDeleteArchivedSession: (session) => {
              showDeleteSessionConfirmation(
                session.projectId,
                session.sessionId,
                session.sessionTitle,
                session.provider,
                { isArchived: true },
              );
            },
          }}
          onCollapseSidebar={collapseToRail}
          onNewSession={handleNewSession}
          canCreateSession={Boolean(selectedProject)}
          restartRequired={restartRequired}
          currentVersion={currentVersion}
          profile={profile}
          onShowSettings={onShowSettings}
          projectSelectorProps={{
            projects: sortedProjects,
            selectedProject,
            deletingProjects,
            editingProject,
            editingName,
            tasksEnabled,
            mcpServerStatus,
            isRefreshing,
            isProjectStarred,
            onEditingNameChange: setEditingName,
            onProjectSelect: handleProjectSelect,
            onToggleStarProject: toggleStarProject,
            onStartEditingProject: startEditing,
            onCancelEditingProject: cancelEditing,
            onSaveProjectName: (projectId) => {
              void saveProjectName(projectId);
            },
            onDeleteProject: requestProjectDelete,
            onCreateProject: () => setShowNewProject(true),
            onRefresh: () => {
              void refreshProjects();
            },
          }}
          sessionListProps={{
            projects,
            selectedProject,
            selectedSession,
            activeSessions,
            attentionSessionIds,
            isLoading,
            loadingProgress,
            initialSessionsLoaded,
            isLoadingMoreSessions: selectedProject ? loadingMoreProjects.has(selectedProject.projectId) : false,
            currentTime,
            editingSession,
            editingSessionName,
            onEditingSessionNameChange: setEditingSessionName,
            onStartEditingSession: (sessionId, initialName) => {
              setEditingSession(sessionId);
              setEditingSessionName(initialName);
            },
            onCancelEditingSession: () => {
              setEditingSession(null);
              setEditingSessionName('');
            },
            onSaveEditingSession: (projectId, sessionId, summary, provider) => {
              void updateSessionSummary(projectId, sessionId, summary, provider);
            },
            onProjectSelect: handleProjectSelect,
            onSessionSelect: handleSessionClick,
            onDeleteSession: showDeleteSessionConfirmation,
            onLoadMoreSessions: loadMoreSessionsForProject,
          }}
          t={t}
        />
      )}
    </>
  );
}

export default Sidebar;
