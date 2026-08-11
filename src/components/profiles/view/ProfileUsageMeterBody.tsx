import { Gauge, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { Badge, Button } from '../../../shared/view/ui';
import type { Profile, ProfileUsageSnapshot } from '../types';

// Meter fill escalates: warning past 80% utilization, danger past 90%.
const WARNING_THRESHOLD = 80;
const DANGER_THRESHOLD = 90;

interface ProfileUsageMeterBodyProps {
  snapshot: ProfileUsageSnapshot | null;
  provider: Profile['provider'];
  isLoading: boolean;
  failed: boolean;
  onRefresh: () => void;
}

export default function ProfileUsageMeterBody({
  snapshot,
  provider,
  isLoading,
  failed,
  onRefresh,
}: ProfileUsageMeterBodyProps) {
  const { t, i18n } = useTranslation('settings');

  if (snapshot && !snapshot.supported) {
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
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          {t('profiles.usage.title', { defaultValue: 'Plan usage' })}
          {snapshot?.plan && (
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide">{snapshot.plan}</Badge>
          )}
        </div>
        <Button
          onClick={onRefresh}
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

      {snapshot?.status === 'unauthenticated' && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('profiles.usage.unauthenticated', {
            defaultValue: 'Sign in to this profile to see its plan usage.',
          })}
        </p>
      )}

      {snapshot?.status === 'unavailable' && snapshot.supported && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('profiles.usage.unavailable', { defaultValue: 'Usage data is not available right now.' })}
        </p>
      )}

      {snapshot?.status === 'ok' && (
        <div className="mt-2 space-y-2">
          {snapshot.windows.map((window) => {
            const resetLabel = formatTime(window.resetsAt);
            const utilization = Math.min(100, Math.max(0, window.utilization));
            const isDanger = window.utilization >= DANGER_THRESHOLD;
            const isWarning = window.utilization >= WARNING_THRESHOLD;
            return (
              <div key={window.id}>
                <div className="flex items-center justify-between gap-2 font-mono text-[11px] tracking-wide">
                  <span className="text-muted-foreground">{window.label}</span>
                  <span className="font-medium text-foreground">
                    {Math.round(window.utilization)}%
                    {resetLabel && (
                      <span className="font-normal text-faint">
                        {' · '}
                        {t('profiles.usage.resets', { time: resetLabel, defaultValue: 'resets {{time}}' })}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-150 ease-out',
                      isDanger ? 'bg-danger' : isWarning ? 'bg-warning' : 'bg-primary',
                    )}
                    style={{ width: `${utilization}%` }}
                  />
                </div>
              </div>
            );
          })}
          {provider === 'codex' && snapshot.asOf && (
            <p className="font-mono text-[11px] tracking-wide text-faint">
              {t('profiles.usage.asOf', {
                time: formatTime(snapshot.asOf) ?? snapshot.asOf,
                defaultValue: 'as of last session activity ({{time}})',
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
