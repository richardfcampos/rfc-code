import { useState } from 'react';
import { Gauge, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CAVEMAN_MODES,
  RTK_MODES,
  type CavemanMode,
  type ProfileWithStatus,
  type RtkMode,
} from '../types';

/**
 * Agent tooling defaults for one profile.
 *
 * Both add-ons are Claude Code plugins/hooks, so the controls are disabled for
 * every other provider with the reason shown, rather than offering a switch
 * that would silently do nothing.
 *
 * The two levels are deliberately not presented as a matched pair: caveman is a
 * per-session default that a session can override, while RTK applies to every
 * session of the profile at once. The labels say so.
 */
export default function ProfileToolingControls({
  profile,
  onChange,
}: {
  profile: ProfileWithStatus;
  onChange: (
    profileId: string,
    modes: { cavemanMode?: CavemanMode | null; rtkMode?: RtkMode | null },
  ) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [pending, setPending] = useState<'caveman' | 'rtk' | null>(null);

  const supported = profile.provider === 'claude';

  const apply = async (
    key: 'caveman' | 'rtk',
    modes: { cavemanMode?: CavemanMode | null; rtkMode?: RtkMode | null },
  ) => {
    setPending(key);
    try {
      await onChange(profile.id, modes);
    } catch {
      // actionError from useProfiles already surfaces the failure message.
    } finally {
      setPending(null);
    }
  };

  if (!supported) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('profiles.tooling.unsupported', {
          provider: profile.provider,
          defaultValue:
            'Response compression and command rewriting are Claude Code plugins, so they do not apply to {{provider}} sessions.',
        })}
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Gauge className="h-3.5 w-3.5 text-purple-500" />
          {t('profiles.tooling.caveman.label', { defaultValue: 'Response compression' })}
        </span>
        <select
          value={profile.cavemanMode ?? ''}
          disabled={pending !== null}
          onChange={(event) =>
            apply('caveman', {
              cavemanMode: event.target.value === '' ? null : (event.target.value as CavemanMode),
            })
          }
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
        >
          <option value="">
            {t('profiles.tooling.unset', { defaultValue: 'Not configured' })}
          </option>
          {CAVEMAN_MODES.map((mode) => (
            <option key={mode} value={mode}>{mode}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {t('profiles.tooling.caveman.hint', {
            defaultValue: 'Default for new sessions on this account; each session can override it.',
          })}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Terminal className="h-3.5 w-3.5 text-purple-500" />
          {t('profiles.tooling.rtk.label', { defaultValue: 'Command rewriting' })}
        </span>
        <select
          value={profile.rtkMode ?? ''}
          disabled={pending !== null}
          onChange={(event) =>
            apply('rtk', {
              rtkMode: event.target.value === '' ? null : (event.target.value as RtkMode),
            })
          }
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
        >
          <option value="">
            {t('profiles.tooling.unset', { defaultValue: 'Not configured' })}
          </option>
          {RTK_MODES.map((mode) => (
            <option key={mode} value={mode}>{mode}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {t('profiles.tooling.rtk.hint', {
            defaultValue: 'Applies to every session on this account — there is no per-session override.',
          })}
        </span>
      </label>
    </div>
  );
}
