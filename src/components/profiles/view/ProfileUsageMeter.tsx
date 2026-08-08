import { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../utils/api';
import { Badge, Button } from '../../../shared/view/ui';
import type { Profile, ProfileUsageSnapshot } from '../types';

// Plan-limit usage for the account behind a profile (5h/weekly windows).
// Rendered only for providers with a usage source; degrades to a short note
// when the account is logged out or the source is unreachable.

const barColor = (utilization: number): string => {
  if (utilization >= 90) {
    return 'bg-red-500';
  }
  if (utilization >= 70) {
    return 'bg-amber-500';
  }
  return 'bg-emerald-500';
};

async function fetchUsage(profileId: string): Promise<ProfileUsageSnapshot> {
  const response = await authenticatedFetch(`/api/profiles/${profileId}/usage`);
  const body = (await response.json()) as { success?: boolean; data?: { usage?: ProfileUsageSnapshot } };
  if (!response.ok || !body.success || !body.data?.usage) {
    throw new Error('Failed to load usage');
  }
  return body.data.usage;
}

export default function ProfileUsageMeter({ profile }: { profile: Profile }) {
  const { t, i18n } = useTranslation('settings');
  const [usage, setUsage] = useState<ProfileUsageSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setFailed(false);
    try {
      setUsage(await fetchUsage(profile.id));
    } catch {
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (usage && !usage.supported) {
    return null;
  }

  const formatTime = (iso: string | null): string | null => {
    if (!iso) {
      return null;
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString(i18n.language, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Gauge className="h-4 w-4 text-purple-500" />
          {t('profiles.usage.title', { defaultValue: 'Plan usage' })}
          {usage?.plan && (
            <Badge variant="outline" className="text-xs uppercase">{usage.plan}</Badge>
          )}
        </div>
        <Button
          onClick={() => void load()}
          variant="ghost"
          size="sm"
          disabled={isLoading}
          title={t('profiles.usage.refresh', { defaultValue: 'Refresh usage' })}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {failed && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('profiles.usage.loadFailed', { defaultValue: 'Could not load usage.' })}
        </p>
      )}

      {usage?.status === 'unauthenticated' && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('profiles.usage.unauthenticated', {
            defaultValue: 'Sign in to this profile to see its plan usage.',
          })}
        </p>
      )}

      {usage?.status === 'unavailable' && usage.supported && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('profiles.usage.unavailable', { defaultValue: 'Usage data is not available right now.' })}
        </p>
      )}

      {usage?.status === 'ok' && (
        <div className="mt-2 space-y-2">
          {usage.windows.map((window) => {
            const resetLabel = formatTime(window.resetsAt);
            return (
              <div key={window.id}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{window.label}</span>
                  <span>
                    {Math.round(window.utilization)}%
                    {resetLabel && (
                      <>
                        {' · '}
                        {t('profiles.usage.resets', { time: resetLabel, defaultValue: 'resets {{time}}' })}
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${barColor(window.utilization)}`}
                    style={{ width: `${Math.min(100, Math.max(0, window.utilization))}%` }}
                  />
                </div>
              </div>
            );
          })}
          {profile.provider === 'codex' && usage.asOf && (
            <p className="text-xs text-muted-foreground">
              {t('profiles.usage.asOf', {
                time: formatTime(usage.asOf) ?? usage.asOf,
                defaultValue: 'as of last session activity ({{time}})',
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
