import { Plus, Search, Sparkles, AlertTriangle, SlidersHorizontal } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import type { SidebarProfileChip } from '../../hooks/useSidebarProfileChip';

/** One rail entry: a session that is working or waiting on the user. */
export type SidebarRailSession = {
  id: string;
  title: string;
  /** `run` pulses in the accent colour, `attn` is a steady warning dot. */
  status: 'run' | 'attn';
  isSelected: boolean;
  onSelect: () => void;
};

type SidebarCollapsedProps = {
  onExpand: () => void;
  onNewSession: () => void;
  canCreateSession: boolean;
  railSessions: SidebarRailSession[];
  profile: SidebarProfileChip | null;
  onShowSettings: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  onShowVersionModal: () => void;
  t: TFunction;
};

const RAIL_BUTTON_CLASS =
  'group relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-ctl transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function TerminalGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/**
 * Narrow icon rail: the sidebar's shape on tablet widths and whenever the user
 * collapses it by hand. Brand mark on top, one dot-badged icon per session that
 * is running or waiting, then new-session and search, with the account chip
 * pinned to the bottom edge.
 */
export default function SidebarCollapsed({
  onExpand,
  onNewSession,
  canCreateSession,
  railSessions,
  profile,
  onShowSettings,
  updateAvailable,
  restartRequired,
  onShowVersionModal,
  t,
}: SidebarCollapsedProps) {
  const expandLabel = t('common:versionUpdate.ariaLabels.showSidebar');
  const searchLabel = t('search.sessionsPlaceholder', 'filter sessions');
  const newSessionLabel = t('sessions.newSession');

  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 bg-background/80 py-2 backdrop-blur-sm">
      {/* Brand mark doubles as the expand affordance, so the manual collapse
          toggle always has a way back. */}
      <button
        type="button"
        onClick={onExpand}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-ctl bg-primary transition-opacity duration-150 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={expandLabel}
        title={expandLabel}
      >
        <TerminalGlyph className="h-3.5 w-3.5 text-primary-foreground" />
      </button>

      <div className="rail-sep nav-divider my-1 w-6" />

      {/* Only the session icons scroll — the new-session and search actions stay
          reachable however long the running list gets. */}
      <div className="scrollbar-hide flex min-h-0 w-full flex-col items-center gap-1 overflow-y-auto">
        {railSessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={session.onSelect}
            className={cn(
              RAIL_BUTTON_CLASS,
              'border',
              session.isSelected
                ? 'border-[var(--accent-line-strong)] bg-[var(--accent-tint)]'
                : 'border-border',
            )}
            aria-label={session.title}
            title={session.title}
          >
            <TerminalGlyph
              className={cn(
                'h-3.5 w-3.5 transition-colors duration-150 ease-out',
                session.isSelected ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background',
                session.status === 'attn' ? 'bg-warning' : 'animate-pulse bg-primary',
              )}
            />
          </button>
        ))}
      </div>

      <div className="mt-1 flex w-full flex-1 flex-col items-center gap-1">
        <button
          type="button"
          onClick={onNewSession}
          disabled={!canCreateSession}
          className={cn(RAIL_BUTTON_CLASS, 'disabled:cursor-not-allowed disabled:opacity-40')}
          aria-label={newSessionLabel}
          title={newSessionLabel}
        >
          <Plus className="h-4 w-4 text-muted-foreground transition-colors duration-150 ease-out group-hover:text-foreground" />
        </button>

        {/* No room for a field in the rail — searching expands the sidebar,
            where the filter input lives. */}
        <button
          type="button"
          onClick={onExpand}
          className={RAIL_BUTTON_CLASS}
          aria-label={searchLabel}
          title={searchLabel}
        >
          <Search className="h-4 w-4 text-muted-foreground transition-colors duration-150 ease-out group-hover:text-foreground" />
        </button>
      </div>

      {restartRequired && (
        <div
          className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-ctl"
          aria-label={t('version.restartRequired')}
          title={t('version.restartRequired')}
        >
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warning ring-2 ring-background" />
        </div>
      )}

      {updateAvailable && (
        <button
          type="button"
          onClick={onShowVersionModal}
          className={RAIL_BUTTON_CLASS}
          aria-label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          title={t('common:versionUpdate.ariaLabels.updateAvailable')}
        >
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary ring-2 ring-background" />
        </button>
      )}

      <div className="rail-sep nav-divider my-1 w-6" />

      <button
        type="button"
        onClick={onShowSettings}
        className={RAIL_BUTTON_CLASS}
        aria-label={t('actions.settings')}
        title={profile ? profile.name : t('actions.settings')}
      >
        {profile ? (
          <span
            className="flex h-[22px] w-[22px] items-center justify-center rounded-ctl border border-border font-mono text-[10px] lowercase text-primary"
            aria-hidden="true"
          >
            {profile.initial}
          </span>
        ) : (
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground transition-colors duration-150 ease-out group-hover:text-foreground" />
        )}
      </button>
    </div>
  );
}
