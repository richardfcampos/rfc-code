import { useEffect } from 'react';
import type { TFunction } from 'i18next';

import { ScrollArea } from '../../../../shared/view/ui';
import type { ConversationSearchResults, SearchProgress } from '../../hooks/useSidebarController';
import type { SidebarProfileChip } from '../../hooks/useSidebarProfileChip';
import type { SidebarSearchMode } from '../../types/types';

import SidebarArchivedPanel, { type SidebarArchivedPanelProps } from './SidebarArchivedPanel';
import SidebarConversationResults from './SidebarConversationResults';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectSelector, { type SidebarProjectSelectorProps } from './SidebarProjectSelector';
import SidebarSessionGroups, { type SidebarSessionListProps } from './SidebarSessionGroups';
import SidebarSessionToolbar from './SidebarSessionToolbar';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  runningSessionsCount: number;
  conversationResults: ConversationSearchResults | null;
  isSearching: boolean;
  searchProgress: SearchProgress | null;
  onConversationResultClick: (
    projectId: string | null,
    sessionId: string,
    provider: string,
    messageTimestamp?: string | null,
    messageSnippet?: string | null,
  ) => void;
  archivedPanelProps: Omit<SidebarArchivedPanelProps, 't'>;
  onCollapseSidebar: () => void;
  onNewSession: () => void;
  canCreateSession: boolean;
  restartRequired: boolean;
  currentVersion: string;
  profile: SidebarProfileChip | null;
  onShowSettings: () => void;
  projectSelectorProps: Omit<SidebarProjectSelectorProps, 't'>;
  sessionListProps: Omit<SidebarSessionListProps, 't' | 'sessionFilter' | 'showRunningOnly'>;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  runningSessionsCount,
  conversationResults,
  isSearching,
  searchProgress,
  onConversationResultClick,
  archivedPanelProps,
  onCollapseSidebar,
  onNewSession,
  canCreateSession,
  restartRequired,
  currentVersion,
  profile,
  onShowSettings,
  projectSelectorProps,
  sessionListProps,
  t,
}: SidebarContentProps) {
  const showConversationSearch = searchMode === 'conversations' && searchFilter.trim().length >= 2;
  const selectedProject = projectSelectorProps.selectedProject;

  useEffect(() => {
    let baseTitle = 'RFC Code';
    const displayName = selectedProject?.displayName?.trim();
    if (displayName) {
      baseTitle = `${displayName} - ${baseTitle}`;
    }
    document.title = baseTitle;
  }, [selectedProject]);

  return (
    <div className="flex h-full flex-col bg-background/80 backdrop-blur-sm md:w-[264px] md:select-none">
      <SidebarHeader isPWA={isPWA} isMobile={isMobile} onCollapseSidebar={onCollapseSidebar} t={t} />

      <div className="flex-shrink-0 space-y-1.5 px-2 py-2">
        <SidebarProjectSelector {...projectSelectorProps} t={t} />
        <SidebarSessionToolbar
          canCreateSession={canCreateSession}
          onNewSession={onNewSession}
          searchFilter={searchFilter}
          onSearchFilterChange={onSearchFilterChange}
          onClearSearchFilter={onClearSearchFilter}
          searchMode={searchMode}
          onSearchModeChange={onSearchModeChange}
          runningSessionsCount={runningSessionsCount}
          t={t}
        />
      </div>

      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain">
        {showConversationSearch ? (
          <SidebarConversationResults
            conversationResults={conversationResults}
            isSearching={isSearching}
            searchProgress={searchProgress}
            onConversationResultClick={onConversationResultClick}
            t={t}
          />
        ) : searchMode === 'archived' ? (
          <SidebarArchivedPanel {...archivedPanelProps} t={t} />
        ) : (
          <SidebarSessionGroups
            {...sessionListProps}
            sessionFilter={searchMode === 'conversations' ? '' : searchFilter}
            showRunningOnly={searchMode === 'running'}
            t={t}
          />
        )}
      </ScrollArea>

      <SidebarFooter
        restartRequired={restartRequired}
        currentVersion={currentVersion}
        profile={profile}
        onShowSettings={onShowSettings}
        t={t}
      />
    </div>
  );
}
