import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { AppTab } from '../../../../types/app';

import MainContentTabSwitcher from './MainContentTabSwitcher';

type MainContentTabBarProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
  className?: string;
};

/**
 * Scroll-fade wrapper around the tab switcher. Extracted so the header can
 * mount it twice — once in the single-row desktop/tablet layout, once in the
 * icon-only mobile row — without duplicating the scroll-edge logic.
 */
export default function MainContentTabBar({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  className = '',
}: MainContentTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollState]);

  return (
    <div className={`relative min-w-0 overflow-hidden ${className}`}>
      {canScrollLeft && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
      )}
      {/* `overflow-x-auto` also makes the block axis scrollable, which would clip
          the active tab's 2px underline (it hangs 4px below the pill). The
          matching bottom padding keeps it inside the scroll box. */}
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="scrollbar-hide overflow-x-auto pb-1"
      >
        <MainContentTabSwitcher
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          shouldShowTasksTab={shouldShowTasksTab}
          shouldShowBrowserTab={shouldShowBrowserTab}
        />
      </div>
      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
      )}
    </div>
  );
}
