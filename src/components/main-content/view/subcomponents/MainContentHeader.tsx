import type { MainContentHeaderProps } from '../../types/types';

import MobileMenuButton from './MobileMenuButton';
import MainContentTabBar from './MainContentTabBar';
import MainContentTitle from './MainContentTitle';
import HeaderSessionIdentity from './HeaderSessionIdentity';
import HeaderWorktreeChip from './HeaderWorktreeChip';
import HeaderThemeToggle from './HeaderThemeToggle';
import HeaderOverflowMenu from './HeaderOverflowMenu';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  isMobile,
  onMenuClick,
}: MainContentHeaderProps) {
  return (
    <div className="pwa-header-safe flex-shrink-0 border-b border-border/60 bg-background px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}

          {/* Below 640px there's no room for the tab labels next to a title,
              so the session/tab title takes the row and the tabs move to
              their own icon-only row underneath. */}
          <div className="min-w-0 flex-1 sm:hidden">
            <MainContentTitle
              activeTab={activeTab}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              shouldShowTasksTab={shouldShowTasksTab}
            />
          </div>

          {/* 640px and up: no title — tabs sit at the header's left edge. The
              hamburger still shows in the 640–767px band (`isMobile` is a JS
              <768 check while `sm:` is CSS ≥640), so that band reads as
              hamburger + tabs + the right cluster, with the session's account
              controls moved there rather than lost with the title. */}
          <MainContentTabBar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            shouldShowTasksTab={shouldShowTasksTab}
            shouldShowBrowserTab={shouldShowBrowserTab}
            className="hidden sm:block sm:flex-shrink-0"
          />
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* Session provider/profile/account-switch controls. Below 640px they
              render inside MainContentTitle instead — the `sm:` split keeps
              exactly one mount per breakpoint. */}
          <HeaderSessionIdentity
            activeTab={activeTab}
            selectedSession={selectedSession}
            className="hidden sm:flex"
          />

          {/* Worktree chip and theme toggle need room next to the tab bar;
              below `lg` they drop and the toggle is still reachable from the
              overflow menu. */}
          <HeaderWorktreeChip selectedSession={selectedSession} className="hidden lg:inline-flex" />
          <HeaderThemeToggle className="hidden lg:inline-flex" />
          <HeaderOverflowMenu />
        </div>
      </div>

      <MainContentTabBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        shouldShowTasksTab={shouldShowTasksTab}
        shouldShowBrowserTab={shouldShowBrowserTab}
        className="mt-1.5 sm:hidden"
      />
    </div>
  );
}
