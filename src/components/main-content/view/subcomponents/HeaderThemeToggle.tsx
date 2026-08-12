import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../../contexts/ThemeContext';

type HeaderThemeToggleProps = {
  className?: string;
};

const BUTTON_CLASSES =
  'rounded-ctl p-1.5 text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Icon-only theme toggle wired to the app's existing theme mechanism
 * (`ThemeContext` / `useTheme`), matching the shared `DarkModeToggle`'s own
 * icon convention: the icon shown reflects the theme that is currently
 * active, not the one a click would switch to.
 */
export default function HeaderThemeToggle({ className = '' }: HeaderThemeToggleProps) {
  const { t } = useTranslation();
  const { isDarkMode, toggleDarkMode } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleDarkMode}
      aria-label={t('mainContent.toggleTheme', 'Toggle theme')}
      title={t('mainContent.toggleTheme', 'Toggle theme')}
      className={`${BUTTON_CLASSES} ${className}`}
    >
      {isDarkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
