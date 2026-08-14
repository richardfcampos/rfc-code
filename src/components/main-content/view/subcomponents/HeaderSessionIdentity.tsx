import type { AppTab, ProjectSession } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { SessionAccountSwitcher, SessionProfileBadge } from '../../../profiles';
import type { SessionNavigationOptions } from '../../../chat/types/types';

type HeaderSessionIdentityProps = {
  activeTab: AppTab;
  selectedSession: ProjectSession | null;
  className?: string;
  /** Navigates to a seeded session once a cross-provider handoff creates one. */
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  /** Re-syncs the sidebar so a freshly seeded session shows up there. */
  onSessionsRefresh?: () => void;
};

/**
 * Provider logo, profile badge and account switcher for the active chat
 * session. These ride along with the session title below 640px, but the header
 * drops that title at wider widths — so the desktop header mounts this cluster
 * next to the worktree chip instead. The two mount sites are mutually
 * exclusive by breakpoint (`sm:hidden` on the title row, `hidden sm:flex`
 * here), so the account switcher never renders twice.
 *
 * Renders nothing outside the chat tab or without a session: there is no
 * account to show, let alone hand over.
 */
export default function HeaderSessionIdentity({
  activeTab,
  selectedSession,
  className = '',
  onNavigateToSession,
  onSessionsRefresh,
}: HeaderSessionIdentityProps) {
  if (activeTab !== 'chat' || !selectedSession) {
    return null;
  }

  return (
    // No gap: the badge and switcher carry their own leading margins, so the
    // spacing here matches the mobile title row exactly.
    <div className={cn('min-w-0 items-center', className)}>
      <SessionProviderLogo provider={selectedSession.__provider} className="h-4 w-4 flex-shrink-0" />
      <SessionProfileBadge provider={selectedSession.__provider} profileId={selectedSession.profileId} />
      <SessionAccountSwitcher
        sessionId={selectedSession.id}
        provider={selectedSession.__provider}
        currentProfileId={selectedSession.profileId}
        onNavigateToSession={onNavigateToSession}
        onSessionsRefresh={onSessionsRefresh}
      />
    </div>
  );
}
