import { Activity, Archive, MessageSquare, Plus, Search, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { SidebarSearchMode } from '../../types/types';

type SidebarSessionToolbarProps = {
  canCreateSession: boolean;
  onNewSession: () => void;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  runningSessionsCount: number;
  t: TFunction;
};

const MODE_BUTTON_CLASS =
  'flex h-6 w-6 items-center justify-center rounded-ctl transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function SidebarSessionToolbar({
  canCreateSession,
  onNewSession,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  runningSessionsCount,
  t,
}: SidebarSessionToolbarProps) {
  const placeholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : t('search.sessionsPlaceholder', 'filter sessions');

  const toggleMode = (mode: SidebarSearchMode) => {
    onSearchModeChange(searchMode === mode ? 'projects' : mode);
  };

  const modes: { mode: SidebarSearchMode; icon: typeof Activity; label: string }[] = [
    { mode: 'conversations', icon: MessageSquare, label: t('search.modeConversations') },
    { mode: 'running', icon: Activity, label: t('search.runningTooltip', 'Running sessions') },
    { mode: 'archived', icon: Archive, label: t('search.archiveOnlyTooltip', 'Archive only') },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-ctl border border-border text-[13px] leading-5 text-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onNewSession}
          disabled={!canCreateSession}
          title={t('sessions.newSession')}
        >
          <Plus className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{t('sessions.newSession')}</span>
        </button>
        <kbd
          aria-hidden="true"
          className="flex h-8 w-7 flex-shrink-0 items-center justify-center rounded-ctl border border-border font-mono text-[10px] tracking-wide text-muted-foreground"
        >
          N
        </kbd>
      </div>

      <div className="flex h-7 items-center gap-1 rounded-ctl border border-transparent bg-[var(--hover-soft)] pl-2 pr-1 transition-colors duration-150 ease-out focus-within:border-border focus-within:bg-transparent">
        <Search className="h-3 w-3 flex-shrink-0 text-faint" />
        <input
          type="text"
          value={searchFilter}
          onChange={(event) => onSearchFilterChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-[11px] tracking-wide text-foreground placeholder:text-faint focus-visible:outline-none"
        />
        {searchFilter && (
          <button
            type="button"
            className={MODE_BUTTON_CLASS}
            onClick={onClearSearchFilter}
            title={t('tooltips.clearSearch')}
            aria-label={t('tooltips.clearSearch')}
          >
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
        {modes.map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            type="button"
            className={cn(MODE_BUTTON_CLASS, searchMode === mode && 'bg-[var(--accent-tint)]')}
            onClick={() => toggleMode(mode)}
            aria-pressed={searchMode === mode}
            aria-label={label}
            title={label}
          >
            <span className="relative flex h-3 w-3 items-center justify-center">
              <Icon
                className={cn(
                  'h-3 w-3',
                  searchMode === mode ? 'text-primary' : 'text-faint',
                  mode === 'running' && runningSessionsCount > 0 && 'text-primary',
                )}
              />
              {mode === 'running' && runningSessionsCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 font-mono text-[8px] leading-none tracking-wide text-primary-foreground">
                  {runningSessionsCount > 99 ? '99+' : runningSessionsCount}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
