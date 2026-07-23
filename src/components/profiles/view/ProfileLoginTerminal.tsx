import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import { DEFAULT_PROJECT_FOR_EMPTY_SHELL } from '../../../constants/config';
import { getProfileLoginCommand } from '../utils/profileLoginCommand';
import type { Profile } from '../types';

type ProfileLoginTerminalProps = {
  isOpen: boolean;
  profile: Profile | null;
  onClose: () => void;
  onComplete?: (exitCode: number) => void;
};

/**
 * Guided re-auth terminal for one account profile (HUB-05 AC3): opens the
 * existing web terminal with that profile's isolated env pre-injected and a
 * provider-specific login command suggested, so the CLI's interactive OAuth
 * flow writes credentials into the right config dir.
 */
export default function ProfileLoginTerminal({
  isOpen,
  profile,
  onClose,
  onComplete,
}: ProfileLoginTerminalProps) {
  const { t } = useTranslation('settings');

  if (!isOpen || !profile) {
    return null;
  }

  const command = getProfileLoginCommand(profile.provider);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50 max-md:items-stretch max-md:justify-stretch">
      <div className="flex h-3/4 w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800 max-md:m-0 max-md:h-full max-md:max-w-none max-md:rounded-none md:m-4 md:h-3/4 md:max-w-4xl md:rounded-lg">
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('profiles.login.title', { name: profile.name, defaultValue: 'Authenticate {{name}}' })}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            aria-label={t('profiles.login.close', { defaultValue: 'Close login terminal' })}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <StandaloneShell
            project={DEFAULT_PROJECT_FOR_EMPTY_SHELL}
            command={command}
            profileId={profile.id}
            onComplete={onComplete}
            minimal
          />
        </div>
      </div>
    </div>
  );
}
