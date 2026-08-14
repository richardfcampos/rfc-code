// The switcher modal's "top" panel: either the plain description, a
// cross-provider confirmation card, or the resolved outcome message. Split
// out of `SessionAccountSwitcher.tsx` to stay under the project's 200-line
// cap.

import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/view/ui';
import type { PendingProviderSwitch, ProviderSwitchOutcome } from '../../chat/hooks/useProviderSwitch';
import type { ProfileWithStatus } from '../types';

import { PROVIDER_LABELS } from './providerLabels';

// Only these three outcome kinds are ever handed to this component — `local`
// and `confirmation-required` are handled elsewhere in the parent, and
// `error` is surfaced separately via the hook's `error` state.
type SuccessOutcome = Extract<ProviderSwitchOutcome, { kind: 'transplanted' | 'queued' | 'seeded' }>;

type SessionAccountSwitcherStatusProps = {
  pendingConfirmation: PendingProviderSwitch | null;
  successOutcome: SuccessOutcome | null;
  /** Used to resolve the seeded session's provider name (see `describeSeeded`). */
  profiles: ProfileWithStatus[];
  isSwitching: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The `seeded` outcome doesn't carry the target provider itself (only its
 * profile id), so its name is resolved from the already-loaded profile list
 * rather than threading another field through the hook. Falls back to a
 * generic phrase in the unlikely case that profile fell out of the list
 * between confirming and the switch resolving.
 */
function describeSeeded(
  outcome: Extract<SuccessOutcome, { kind: 'seeded' }>,
  profiles: ProfileWithStatus[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const targetProfile = profiles.find((profile) => profile.id === outcome.profileId);
  const provider = targetProfile
    ? PROVIDER_LABELS[targetProfile.provider]
    : t('profiles.accountSwitcher.anotherProvider', { defaultValue: 'another provider' });

  return outcome.primed
    ? t('profiles.accountSwitcher.outcome.seededPrimed', {
      provider,
      defaultValue: 'The conversation continues in a new session on {{provider}}.',
    })
    : t('profiles.accountSwitcher.outcome.seededUnprimed', {
      provider,
      defaultValue:
        'A new session was started on {{provider}} — the earlier conversation could not be carried over, so it begins without that context.',
    });
}

export default function SessionAccountSwitcherStatus({
  pendingConfirmation,
  successOutcome,
  profiles,
  isSwitching,
  onConfirm,
  onCancel,
}: SessionAccountSwitcherStatusProps) {
  const { t } = useTranslation('settings');

  if (pendingConfirmation) {
    const provider = PROVIDER_LABELS[pendingConfirmation.toProvider];
    return (
      <div className="space-y-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-100">
        <p className="font-medium">
          {t('profiles.accountSwitcher.confirmTitle', { provider, defaultValue: 'Switch to {{provider}}?' })}
        </p>
        <p>
          {t('profiles.accountSwitcher.confirmBody', {
            provider,
            profileName: pendingConfirmation.profileName,
            defaultValue:
              'This starts a new session on {{provider}} using "{{profileName}}", seeded with this conversation as context. This session stays here and remains available.',
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('profiles.accountSwitcher.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button size="sm" disabled={isSwitching} onClick={onConfirm}>
            {isSwitching
              ? t('profiles.accountSwitcher.switching', { defaultValue: 'Switching…' })
              : t('profiles.accountSwitcher.confirmAction', { defaultValue: 'Start new session' })}
          </Button>
        </div>
      </div>
    );
  }

  if (successOutcome) {
    const message = successOutcome.kind === 'queued'
      ? t('profiles.accountSwitcher.outcome.queued', {
        defaultValue: 'A turn is running — the switch will apply when it finishes.',
      })
      : successOutcome.kind === 'transplanted'
        ? t('profiles.accountSwitcher.outcome.transplanted', {
          defaultValue: 'Account switched. The next turn continues on the new account.',
        })
        : describeSeeded(successOutcome, profiles, t);

    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        {message}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      {t('profiles.accountSwitcher.description', { defaultValue: 'Continue this session on a different account.' })}
    </p>
  );
}
