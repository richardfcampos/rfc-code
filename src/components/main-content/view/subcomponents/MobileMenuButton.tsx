import type { MobileMenuButtonProps } from '../../types/types';
import { useMobileMenuHandlers } from '../../hooks/useMobileMenuHandlers';

export default function MobileMenuButton({ onMenuClick, compact = false }: MobileMenuButtonProps) {
  const { handleMobileMenuClick, handleMobileMenuTouchEnd } = useMobileMenuHandlers(onMenuClick);

  const focusRingClasses = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
  // The header hamburger is the only way into the sessions drawer on a phone,
  // so it carries a full 44px target below 640px and hands back the compact
  // 32px box once the layout has room for it.
  const buttonClasses = compact
    ? `p-1.5 text-muted-foreground hover:text-foreground rounded-ctl hover:bg-accent/60 transition-colors duration-150 ease-out pwa-menu-button ${focusRingClasses}`
    : `flex h-11 w-11 items-center justify-center sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground rounded-ctl hover:bg-accent/60 transition-colors duration-150 ease-out touch-manipulation active:scale-95 pwa-menu-button flex-shrink-0 ${focusRingClasses}`;

  return (
    <button
      onClick={handleMobileMenuClick}
      onTouchEnd={handleMobileMenuTouchEnd}
      className={buttonClasses}
      aria-label="Open menu"
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
