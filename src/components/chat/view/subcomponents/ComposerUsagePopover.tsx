import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Gauge, Loader2, RefreshCw } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { Badge, Button } from '../../../../shared/view/ui';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { useProfiles } from '../../../profiles/hooks/useProfiles';
import ProfileUsageMeterBody from '../../../profiles/view/ProfileUsageMeterBody';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import { useProfileUsage } from '../../hooks/useProfileUsage';

import {
  ComposerMenuHeading,
  ComposerMenuSurface,
} from './ComposerMenuPrimitives';

// A window's `label` reports the per-model split as `7d Sonnet` / `7d Opus`
// (design.md §Frontend) — this is the closest the source gets to "usage per
// model", so those rows get a highlight the plain 5h/7d windows don't.
const PER_MODEL_WINDOW_PATTERN = /sonnet|opus/i;

export default function ComposerUsagePopover({ activeProfileId }: { activeProfileId: string | null }) {
  const { t, i18n } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 360);

  const { profiles } = useProfiles();
  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  const { entries, order, isFetching, loadError, load } = useProfileUsage(isOpen, activeProfileId);

  const handleToggle = useCallback(() => {
    updateAnchor();
    // Compute `next` outside the `setIsOpen` updater and fetch here instead
    // of inside the updater — updaters can run twice under StrictMode,
    // which would trigger a duplicate fetch.
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      void load();
    }
  }, [isOpen, load, updateAnchor]);

  const handleRefresh = useCallback(() => {
    void load(true);
  }, [load]);

  const formatRetryTime = useCallback((iso: string): string | null => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }, [i18n.language]);

  const ariaLabel = t('composer.usage.button', { defaultValue: 'Plan usage' });
  const hasRows = order.length > 0;
  // `useProfiles` fetches separately from `useProfileUsage` — while it's
  // still in flight `profilesById` is empty, so every row below would
  // resolve to `null` and the popover would render nothing at all. Treat
  // that as a pending state instead of a blank panel.
  const profilesPending = hasRows && profilesById.size === 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-foreground transition-colors hover:bg-muted"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <Gauge className="h-4 w-4" />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          <div className="flex items-center justify-between gap-2 px-1">
            <ComposerMenuHeading>
              {t('composer.usage.title', { defaultValue: 'Plan usage' })}
            </ComposerMenuHeading>
            <Button
              onClick={handleRefresh}
              variant="ghost"
              size="sm"
              disabled={isFetching}
              title={t('composer.usage.refresh', { defaultValue: 'Refresh' })}
              className="h-7 px-2"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            </Button>
          </div>

          {loadError && !hasRows && (
            <p className="px-2.5 py-2 text-sm text-red-600 dark:text-red-400">
              {t('composer.usage.loadFailed', { defaultValue: 'Could not load plan usage.' })}
            </p>
          )}

          {!loadError && !hasRows && isFetching && (
            <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('composer.usage.pending', { defaultValue: 'Loading…' })}
            </div>
          )}

          {!loadError && !hasRows && !isFetching && (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
              {t('composer.usage.empty', { defaultValue: 'No profiles with usage data yet.' })}
            </p>
          )}

          {!loadError && profilesPending && (
            <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('composer.usage.pending', { defaultValue: 'Loading…' })}
            </div>
          )}

          {hasRows && !profilesPending && (
            <div className="space-y-2 px-1 pb-1">
              {order.map((profileId) => {
                const profile = profilesById.get(profileId);
                if (!profile) {
                  return null;
                }

                const envelope = entries[profileId];
                const hasPerModelWindows = Boolean(
                  envelope?.snapshot?.windows?.some((window) => PER_MODEL_WINDOW_PATTERN.test(window.label)),
                );
                const retryLabel = envelope?.retryAt ? formatRetryTime(envelope.retryAt) : null;

                return (
                  <div
                    key={profileId}
                    className={cn(
                      'rounded-lg border border-border/60 p-2',
                      hasPerModelWindows && 'border-purple-400/60 bg-purple-50/60 dark:border-purple-500/40 dark:bg-purple-900/10',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <SessionProviderLogo provider={profile.provider} className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate text-sm font-medium text-foreground">{profile.name}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{profile.provider}</Badge>
                      {hasPerModelWindows && (
                        <Badge variant="outline" className="border-purple-400/60 text-[10px] text-purple-700 dark:text-purple-300">
                          {t('composer.usage.perModel', { defaultValue: 'Per-model' })}
                        </Badge>
                      )}
                    </div>

                    {(!envelope || envelope.state === 'pending') && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t('composer.usage.pending', { defaultValue: 'Loading…' })}
                      </div>
                    )}

                    {envelope?.state === 'cached' && (
                      <ProfileUsageMeterBody
                        snapshot={envelope.snapshot}
                        provider={profile.provider}
                        isLoading={isFetching}
                        failed={false}
                        onRefresh={handleRefresh}
                      />
                    )}

                    {retryLabel && (
                      <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                        {t('composer.usage.lockedUntil', { time: retryLabel, defaultValue: 'Locked until {{time}}' })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
