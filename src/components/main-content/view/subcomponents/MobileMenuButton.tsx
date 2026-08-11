import type { MobileMenuButtonProps } from '../../types/types';
import { useMobileMenuHandlers } from '../../hooks/useMobileMenuHandlers';

export default function MobileMenuButton({ onMenuClick, compact = false }: MobileMenuButtonProps) {
  const { handleMobileMenuClick, handleMobileMenuTouchEnd } = useMobileMenuHandlers(onMenuClick);

  const focusRingClasses = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
  const buttonClasses = compact
    ? `p-1.5 text-muted-foreground hover:text-foreground rounded-ctl hover:bg-accent/60 transition-colors duration-150 ease-out pwa-menu-button ${focusRingClasses}`
    : `p-1.5 text-muted-foreground hover:text-foreground rounded-ctl hover:bg-accent/60 transition-colors duration-150 ease-out touch-manipulation active:scale-95 pwa-menu-button flex-shrink-0 ${focusRingClasses}`;

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
