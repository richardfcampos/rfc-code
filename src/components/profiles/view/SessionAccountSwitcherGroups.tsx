// Grouped, per-provider account list for `SessionAccountSwitcher`. Split out
// of that file to stay under the project's 200-line cap once the switcher had
// to grow from "siblings of one provider" to "every provider, grouped".

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../shared/view/ui';
import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import type { LLMProvider } from '../../../types/app';
import type { ProfileWithStatus } from '../types';

import { PROVIDER_LABELS } from './providerLabels';

// The session's own provider is always shown first; the rest follow in a
// fixed order so the list doesn't reshuffle between opens.
const PROVIDER_ORDER: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];

type ProviderGroup = {
  provider: LLMProvider;
  profiles: ProfileWithStatus[];
};

function groupByProvider(profiles: ProfileWithStatus[], currentProvider: LLMProvider): ProviderGroup[] {
  const order = [currentProvider, ...PROVIDER_ORDER.filter((candidate) => candidate !== currentProvider)];
  return order
    .map((provider) => ({ provider, profiles: profiles.filter((profile) => profile.provider === provider) }))
    .filter((group) => group.profiles.length > 0);
}

type SessionAccountSwitcherGroupsProps = {
  profiles: ProfileWithStatus[];
  currentProvider: LLMProvider;
  currentProfileId?: string | null;
  isSwitching: boolean;
  isLoading: boolean;
  onSelect: (profile: ProfileWithStatus) => void;
};

export default function SessionAccountSwitcherGroups({
  profiles,
  currentProvider,
  currentProfileId,
  isSwitching,
  isLoading,
  onSelect,
}: SessionAccountSwitcherGroupsProps) {
  const { t } = useTranslation('settings');
  const groups = useMemo(
    () => groupByProvider(profiles, currentProvider),
    [profiles, currentProvider],
  );

  const hasOtherAccount = groups.some((group) => group.profiles.some((profile) => (
    !(group.provider === currentProvider && profile.id === currentProfileId)
  )));

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('profiles.accountSwitcher.loadingAccounts', { defaultValue: 'Loading accounts…' })}
      </p>
    );
  }

  if (!hasOtherAccount) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('profiles.accountSwitcher.empty', { defaultValue: 'No other accounts yet.' })}
      </p>
    );
  }

  return (
    <div className="max-h-72 space-y-3 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.provider}>
          <div className="mb-1 flex items-center gap-1.5 px-0.5">
            <SessionProviderLogo provider={group.provider} className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {PROVIDER_LABELS[group.provider]}
            </span>
          </div>
          <ul className="space-y-1.5">
            {group.profiles.map((profile) => {
              const isCurrent = group.provider === currentProvider && profile.id === currentProfileId;
              const isCrossProvider = group.provider !== currentProvider;
              const authenticated = profile.status?.authenticated ?? false;
              const needsAuth = !profile.statusLoading && !authenticated;

              return (
                <li
                  key={profile.id}
                  className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-2.5 py-1.5 sm:min-h-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm text-foreground" title={profile.name}>
                        {profile.name}
                      </span>
                      {isCrossProvider && !isCurrent && (
                        <Badge variant="outline" className="flex-shrink-0 text-[10px]">
                          {t('profiles.accountSwitcher.newSession', { defaultValue: 'New session' })}
                        </Badge>
                      )}
                    </div>
                    {isCurrent && (
                      <span className="text-xs text-muted-foreground">
                        {t('profiles.accountSwitcher.current', { defaultValue: 'Current account' })}
                      </span>
                    )}
                    {!isCurrent && needsAuth && (
                      <span className="text-xs text-red-600 dark:text-red-400">
                        {t('profiles.accountSwitcher.needsAuth', { defaultValue: 'Sign in to this account first' })}
                      </span>
                    )}
                  </div>

                  {!isCurrent && (
                    <Button
                      size="sm"
                      disabled={needsAuth || profile.statusLoading || isSwitching}
                      onClick={() => onSelect(profile)}
                      className="min-h-[44px] flex-shrink-0 sm:min-h-0"
                      title={needsAuth
                        ? t('profiles.accountSwitcher.needsAuth', { defaultValue: 'Sign in to this account first' })
                        : undefined}
                    >
                      {isSwitching
                        ? t('profiles.accountSwitcher.switching', { defaultValue: 'Switching…' })
                        : t('profiles.accountSwitcher.switch', { defaultValue: 'Switch' })}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
