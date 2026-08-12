import { useEffect, useRef, useState } from 'react';
import { Moon, MoreHorizontal, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../../contexts/ThemeContext';

/**
 * Header overflow menu. The header currently has no other actions to move
 * into it, so it carries a copy of the theme toggle — useful below the `lg`
 * breakpoint where the dedicated toggle icon is hidden for space, and
 * harmless (if redundant) above it. Extend this list rather than adding new
 * standalone icon buttons to the header as actions are introduced.
 */
export default function HeaderOverflowMenu() {
  const { t } = useTranslation();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={t('mainContent.moreOptions', 'More options')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex h-11 w-11 items-center justify-center rounded-ctl text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-7 sm:w-7"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="animate-in fade-in-0 zoom-in-95 absolute right-0 top-full z-50 mt-2 min-w-[180px] rounded-card border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-pop)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              toggleDarkMode();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-ctl px-3 py-2 text-left text-sm transition-colors duration-150 ease-out hover:bg-[var(--hover)] focus:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isDarkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {t('mainContent.toggleTheme', 'Toggle theme')}
          </button>
        </div>
      )}
    </div>
  );
}
