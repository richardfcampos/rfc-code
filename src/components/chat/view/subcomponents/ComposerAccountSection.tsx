import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';

import { Button } from '../../../../shared/view/ui';
import type { LLMProvider } from '../../../../types/app';

import { ComposerMenuHeading, ComposerMenuItem } from './ComposerMenuPrimitives';
import type { ComposerAccountSectionProps } from './composerTypes';

const PROVIDER_ORDER: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

interface Props extends ComposerAccountSectionProps {
  /** Menu's own open state, so this section collapses every time the menu closes. */
  isMenuOpen: boolean;
}

/**
 * Provider/Account section of the composer's model menu (HUB-12): lets the
 * user switch which account serves the session without leaving the chat bar.
 * Mirrors the Model section's summary-row-then-expand interaction so the menu
 * reads as one consistent pattern.
 */
export default function ComposerAccountSection({
  provider,
  profilesByProvider,
  selectedProfileId,
  onSelectAccount,
  pendingConfirmation,
  onConfirmSwitch,
  onCancelSwitch,
  isSwitching,
  switchError,
  isMenuOpen,
}: Props) {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) {
      setIsExpanded(false);
    }
  }, [isMenuOpen]);

  const providerLabel = (target: LLMProvider): string => {
    if (target === 'cursor') return t('messageTypes.cursor');
    if (target === 'codex') return t('messageTypes.codex');
    if (target === 'opencode') return t('messageTypes.opencode', { defaultValue: 'OpenCode' });
    return t('messageTypes.claude');
  };

  const currentAccount = (profilesByProvider[provider] ?? []).find(
    (profile) => profile.id === selectedProfileId,
  ) ?? null;
  const summaryLabel = currentAccount?.name || providerLabel(provider);
  // A pending confirmation forces the section open even if the user had
  // collapsed it — there is nowhere else on the composer for it to render.
  const expanded = isExpanded || Boolean(pendingConfirmation);

  return (
    <>
      <ComposerMenuItem
        role="menuitem"
        label={summaryLabel}
        isSelected={false}
        onSelect={() => setIsExpanded((current) => !current)}
        trailing={
          expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        }
        className="text-muted-foreground"
      />

      {expanded && switchError && !pendingConfirmation && (
        <p className="px-2.5 pb-1 text-xs leading-4 text-destructive">{switchError}</p>
      )}

      {expanded && pendingConfirmation && (
        <div className="mx-1 mb-1 rounded-ctl border border-border-strong bg-[var(--hover-soft)] p-2.5">
          <p className="text-[13px] leading-5 text-foreground">
            {t('composer.account.confirmTitle', {
              defaultValue: 'Switch to {{account}} on {{provider}}?',
              account: pendingConfirmation.profileName,
              provider: providerLabel(pendingConfirmation.toProvider),
            })}
          </p>
          <p className="mt-1 text-xs leading-4 text-faint">
            {t('composer.account.confirmBody', {
              defaultValue:
                'This session moves to {{provider}}. The whole conversation carries over — summarized if it doesn\'t fit — and the previous provider\'s response cache is lost.',
              provider: providerLabel(pendingConfirmation.toProvider),
            })}
          </p>
          {switchError && (
            <p className="mt-1 text-xs leading-4 text-destructive">{switchError}</p>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onCancelSwitch}
              disabled={isSwitching}
            >
              {t('composer.account.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onConfirmSwitch}
              disabled={isSwitching}
            >
              {isSwitching
                ? t('composer.account.switching', { defaultValue: 'Switching…' })
                : t('composer.account.confirm', { defaultValue: 'Switch' })}
            </Button>
          </div>
        </div>
      )}

      {expanded && !pendingConfirmation && PROVIDER_ORDER.map((entryProvider) => {
        const accounts = profilesByProvider[entryProvider] ?? [];
        if (accounts.length === 0) {
          return null;
        }

        return (
          <div key={entryProvider}>
            <ComposerMenuHeading>{providerLabel(entryProvider)}</ComposerMenuHeading>
            {accounts.map((profile) => {
              const isCurrent = entryProvider === provider && profile.id === selectedProfileId;
              // Switching to an account that was never signed in fails at the
              // backend guard, so the row is disabled with the reason instead.
              const { authenticated } = profile;
              return (
                <ComposerMenuItem
                  key={profile.id}
                  label={profile.name}
                  description={
                    authenticated
                      ? undefined
                      : t('composer.account.notAuthenticated', { defaultValue: 'Sign in to use this account' })
                  }
                  isSelected={isCurrent}
                  trailing={authenticated ? undefined : <Lock className="h-3.5 w-3.5 text-faint" />}
                  className={authenticated ? undefined : 'opacity-60'}
                  onSelect={() => {
                    if (isCurrent || !authenticated || isSwitching) {
                      return;
                    }
                    void onSelectAccount(profile);
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}
