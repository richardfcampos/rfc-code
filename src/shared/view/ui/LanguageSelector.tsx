

import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

import { languages } from '../../../i18n/languages';

type LanguageSelectorProps = {
  compact?: boolean;
};

/**
 * Language Selector Component
 *
 * A dropdown component for selecting the application language.
 * Automatically updates the i18n language and persists to localStorage.
 *
 * Props:
 * @param {boolean} compact - If true, uses compact style (default: false)
 */
export default function LanguageSelector({ compact = false }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation('settings');

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = event.target.value;
    i18n.changeLanguage(newLanguage);
  };

  // Compact style for QuickSettingsPanel
  if (compact) {
    return (
      <div className="flex items-center justify-between rounded-ctl border border-transparent bg-[var(--hover-soft)] p-3 transition-colors duration-150 ease-out hover:border-border hover:bg-[var(--hover)]">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <Languages className="h-4 w-4 text-faint" />
          {t('account.language')}
        </span>
        <select
          value={i18n.language}
          onChange={handleLanguageChange}
          className="w-auto min-w-[120px] max-w-[160px] rounded-ctl border border-input bg-card p-2 text-sm text-foreground transition-colors duration-150 ease-out focus:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.nativeName}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Full style for Settings page
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div>
        <div className="text-sm font-medium text-foreground">
          {t('account.languageLabel')}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t('account.languageDescription')}
        </div>
      </div>
      <select
        value={i18n.language}
        onChange={handleLanguageChange}
        className="w-36 rounded-ctl border border-input bg-card p-2 text-sm text-foreground transition-colors duration-150 ease-out focus:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {languages.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
