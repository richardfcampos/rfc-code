import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bug, Github, SlidersHorizontal } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../../lib/utils';
import { IS_PLATFORM } from '../../../../constants/config';
import type { SidebarProfileChip } from '../../hooks/useSidebarProfileChip';

const GITHUB_ISSUES_URL = 'https://github.com/siteboon/claudecodeui/issues/new';
const GITHUB_REPO_URL = 'https://github.com/siteboon/claudecodeui';
const DISCORD_INVITE_URL = 'https://discord.gg/buxwujPNRE';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

type SidebarFooterProps = {
  restartRequired: boolean;
  currentVersion: string;
  profile: SidebarProfileChip | null;
  onShowSettings: () => void;
  t: TFunction;
};

const LINK_CLASS =
  'flex items-center gap-2 rounded-ctl px-2 py-1.5 text-xs text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function SidebarFooter({
  restartRequired,
  currentVersion,
  profile,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        // Escape leaves focus stranded on a removed node otherwise, dropping
        // keyboard users back to the top of the document.
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <div className="px-2 pb-1.5">
          <div className="flex items-center gap-2 rounded-card border border-[var(--warning-line)] bg-[var(--warning-tint)] px-2.5 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-warning" />
            <span className="min-w-0 flex-1 text-[11px] text-warning">{t('version.restartRequired')}</span>
          </div>
        </div>
      )}

      <div className="nav-divider" />

      <div ref={containerRef} className="relative flex items-center gap-2 px-2 py-2">
        <button
          ref={triggerRef}
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-ctl px-1 py-1 text-left transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setIsMenuOpen((previous) => !previous)}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label={t('actions.moreLinks', 'About and community links')}
        >
          <span
            className={cn(
              'flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-ctl border border-border font-mono text-[10px] lowercase',
              profile ? 'text-primary' : 'text-faint',
            )}
            aria-hidden="true"
          >
            {/* Without a profile the chip falls back to the version, which
                already carries its own "v" — repeating it in the avatar reads
                as a typo. */}
            {profile ? profile.initial : '#'}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs leading-5 text-foreground">
            {profile ? profile.name : `v${currentVersion}`}
          </span>
          {profile?.usagePercent !== null && profile?.usagePercent !== undefined && (
            <span className="flex-shrink-0 font-mono text-[11px] tracking-wide text-muted-foreground">
              {profile.usagePercent}%
            </span>
          )}
        </button>

        <button
          type="button"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-ctl text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onShowSettings}
          title={t('actions.settings')}
          aria-label={t('actions.settings')}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>

        {isMenuOpen && (
          <div
            role="menu"
            className="absolute bottom-[calc(100%+4px)] left-2 right-2 z-50 rounded-card border border-border bg-card p-1 shadow-[var(--shadow-pop)]"
          >
            <a href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} role="menuitem">
              <Bug className="h-3.5 w-3.5" />
              {t('actions.reportIssue')}
            </a>
            <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} role="menuitem">
              <DiscordIcon className="h-3.5 w-3.5" />
              {t('actions.joinCommunity')}
            </a>
            {!IS_PLATFORM && (
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} role="menuitem">
                <Github className="h-3.5 w-3.5" />
                <span className="font-mono text-[10px] tracking-wide">
                  CloudCLI v{currentVersion} – {t('branding.openSource')}
                </span>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
