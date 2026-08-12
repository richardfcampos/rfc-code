import { useEffect, useState } from 'react';

/**
 * Tablet band: wide enough that the app is not in its mobile drawer layout
 * (the JS `isMobile` flag flips at 768px), but too narrow for a 264px session
 * list next to the thread. Between those bounds the sidebar shows its icon
 * rail instead. The upper bound matches Tailwind's `lg` breakpoint, so CSS
 * rules written against `lg:` and this query agree.
 */
const RAIL_MEDIA_QUERY = '(min-width: 768px) and (max-width: 1023.98px)';

const matchesRailViewport = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(RAIL_MEDIA_QUERY).matches;
};

export function useSidebarRailViewport(): boolean {
  const [isRailViewport, setIsRailViewport] = useState<boolean>(matchesRailViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(RAIL_MEDIA_QUERY);
    const update = () => setIsRailViewport(mediaQuery.matches);

    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return isRailViewport;
}
