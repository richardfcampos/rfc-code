import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../utils/api';
import { Button } from '../../../shared/view/ui';
import type { LLMProvider } from '../../../types/app';
import type { SessionNavigationOptions } from '../../chat/types/types';
import { useProviderSwitch } from '../../chat/hooks/useProviderSwitch';
import type { Profile, ProfileWithStatus } from '../types';

import SessionAccountSwitcherGroups from './SessionAccountSwitcherGroups';
import SessionAccountSwitcherStatus from './SessionAccountSwitcherStatus';

type SessionAccountSwitcherProps = {
  sessionId?: string;
  provider?: LLMProvider;
  currentProfileId?: string | null;
  /** Navigates to a seeded session once a cross-provider handoff creates one. */
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  /** Re-syncs the sidebar so a freshly seeded session shows up there. */
  onSessionsRefresh?: () => void;
};

/**
 * Header action that hands the current session to another account — same
 * provider or a different one. Same-provider targets apply immediately
 * (transplant); cross-provider targets require confirmation because they
 * create a brand-new session seeded with the current conversation, leaving
 * this session behind but still browsable.
 */
export default function SessionAccountSwitcher({
  sessionId,
  provider,
  currentProfileId,
  onNavigateToSession,
  onSessionsRefresh,
}: SessionAccountSwitcherProps) {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileWithStatus[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const {
    requestSwitch,
    confirmSwitch,
    cancelSwitch,
    reset,
    pendingConfirmation,
    isSwitching,
    error,
    lastOutcome,
  } = useProviderSwitch({
    sessionId: sessionId ?? null,
    // Falls back to 'claude' only to keep the hook call unconditional (Rules
    // of Hooks); the component renders nothing below when `provider` is
    // absent, so this value never reaches the UI.
    currentProvider: provider ?? 'claude',
    onNavigateToSession,
    onSessionsRefresh,
  });

  const loadAccounts = useCallback(async () => {
    setLoadError(null);
    setIsLoadingProfiles(true);
    try {
      const response = await authenticatedFetch('/api/profiles');
      const body = await response.json();
      if (!response.ok || !body?.success) {
        throw new Error(t('profiles.accountSwitcher.loadError', { defaultValue: 'Failed to load accounts' }));
      }
      const list = (body.data?.profiles as Profile[] | undefined) ?? [];
      // The list payload already carries each account's auth flag, so the whole
      // modal resolves in one request instead of one status call per account.
      // The status shape is kept because the child rows are shared with the
      // settings tab, which still enriches its list lazily. The flag is coerced
      // because this response is unvalidated JSON: an absent flag must read as
      // "not signed in" rather than silently offering a dead account.
      setProfiles(list.map((profile) => ({
        ...profile,
        status: { authenticated: Boolean(profile.authenticated) },
        statusLoading: false,
      })));
      setIsLoadingProfiles(false);
    } catch (loadingError) {
      setIsLoadingProfiles(false);
      setLoadError(
        loadingError instanceof Error
          ? loadingError.message
          : t('profiles.accountSwitcher.loadError', { defaultValue: 'Failed to load accounts' }),
      );
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      void loadAccounts();
    }
  }, [isOpen, loadAccounts]);

  if (!sessionId || !provider) {
    return null;
  }

  const close = () => {
    setIsOpen(false);
    reset();
  };

  const successOutcome = lastOutcome
    && (lastOutcome.kind === 'transplanted' || lastOutcome.kind === 'queued' || lastOutcome.kind === 'seeded')
    ? lastOutcome
    : null;

  const switcherLabel = t('profiles.accountSwitcher.trigger', { defaultValue: 'Switch account' });

  return (
    <>
      <button
        type="button"
        title={switcherLabel}
        aria-label={switcherLabel}
        onClick={() => setIsOpen(true)}
        className="ml-1 inline-flex flex-shrink-0 items-center rounded-full border border-border/60 bg-muted/40 p-1 text-muted-foreground transition-colors hover:bg-muted"
      >
        <ArrowLeftRight className="h-3 w-3" />
      </button>

      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-lg border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h3 className="text-lg font-medium text-foreground">
                  {t('profiles.accountSwitcher.title', { defaultValue: 'Switch account' })}
                </h3>
                <Button variant="ghost" size="sm" onClick={close}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3 p-4">
                <SessionAccountSwitcherStatus
                  pendingConfirmation={pendingConfirmation}
                  successOutcome={successOutcome}
                  profiles={profiles}
                  isSwitching={isSwitching}
                  onConfirm={() => void confirmSwitch()}
                  onCancel={cancelSwitch}
                />

                {(loadError || (error && !successOutcome)) && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
                    {loadError || error}
                  </div>
                )}

                {!pendingConfirmation && !successOutcome && (
                  <SessionAccountSwitcherGroups
                    profiles={profiles}
                    currentProvider={provider}
                    currentProfileId={currentProfileId}
                    isSwitching={isSwitching}
                    isLoading={isLoadingProfiles}
                    onSelect={(profile) => void requestSwitch(profile)}
                  />
                )}

                {!pendingConfirmation && (
                  <div className="flex justify-end">
                    <Button variant="ghost" onClick={close}>
                      {successOutcome
                        ? t('profiles.accountSwitcher.done', { defaultValue: 'Done' })
                        : t('profiles.accountSwitcher.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
