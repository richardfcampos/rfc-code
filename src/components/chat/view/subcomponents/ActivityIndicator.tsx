import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Shimmer } from '../../../../shared/view/ui';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';

type ActivityIndicatorProps = {
  activity: SessionActivity | null;
  onAbort?: () => void;
  isInputFocused?: boolean;
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];
const EXIT_ANIMATION_MS = 220;

/**
 * Minimal response-in-progress indicator, in the spirit of the inline status
 * lines in Claude Code / Codex / OpenCode: a shimmering activity label, the
 * elapsed time, and an interrupt affordance. Rendered only while the viewed
 * session has an entry in the processing map; it disappears the instant that
 * entry is removed.
 */
export default function ActivityIndicator({ activity, onAbort, isInputFocused = false }: ActivityIndicatorProps) {
  const { t } = useTranslation('chat');
  const [renderedActivity, setRenderedActivity] = useState<SessionActivity | null>(activity);
  const [isExiting, setIsExiting] = useState(false);
  const startedAt = renderedActivity?.startedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (activity) {
      setRenderedActivity(activity);
      setIsExiting(false);
      return;
    }

    if (!renderedActivity) return;

    setIsExiting(true);
    const timer = setTimeout(() => {
      setRenderedActivity(null);
      setIsExiting(false);
    }, EXIT_ANIMATION_MS);

    return () => clearTimeout(timer);
  }, [activity, renderedActivity]);

  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!renderedActivity) return null;

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const label = (renderedActivity.statusText || actionWords[Math.floor(elapsedSeconds / 4) % actionWords.length])
    .replace(/\.+$/, '');

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsedLabel = minutes < 1
    ? t('claudeStatus.elapsed.seconds', { count: seconds, defaultValue: '{{count}}s' })
    : t('claudeStatus.elapsed.minutesSeconds', { minutes, seconds, defaultValue: '{{minutes}}m {{seconds}}s' });
  // One continuous bar docked on top of the composer: it borrows the composer's
  // 14px top radius, drops its own bottom corners and bottom border, and the
  // `chat-activity-tab` clip keeps the float shadow from bleeding across the seam.
  const barClassName = [
    'chat-activity-tab flex h-9 items-center gap-2.5 rounded-composer rounded-b-none border border-b-0 bg-card px-3 shadow-[var(--shadow-float)] transition-colors duration-150 ease-out',
    isInputFocused ? 'border-border-strong' : 'border-border',
  ].join(' ');

  return (
    <div
      className={`pointer-events-none bg-transparent ${
        isExiting ? 'chat-activity-exit' : 'chat-activity-enter'
      }`}
    >
      <div className={barClassName}>
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
        <Shimmer className="min-w-0 truncate text-xs font-medium">{`${label}…`}</Shimmer>
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums tracking-wide text-muted-foreground">
          {elapsedLabel}
        </span>

        {renderedActivity.canInterrupt && onAbort && (
          <button
            type="button"
            onClick={onAbort}
            className="pointer-events-auto inline-flex h-6 shrink-0 items-center gap-1.5 rounded-ctl border border-border px-1.5 text-[11px] text-muted-foreground transition-colors duration-150 ease-out hover:border-border-strong hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('claudeStatus.stop', { defaultValue: 'Stop' })}
          >
            <svg className="h-2.5 w-2.5 fill-current" viewBox="0 0 24 24" aria-hidden>
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
            <span>{t('claudeStatus.stop', { defaultValue: 'Stop' })}</span>
            <kbd className="hidden font-mono text-[10px] tracking-wide text-faint sm:inline-block">
              esc
            </kbd>
          </button>
        )}
      </div>
    </div>
  );
}
