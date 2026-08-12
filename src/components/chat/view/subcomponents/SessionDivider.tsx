import { memo } from 'react';

interface SessionDividerProps {
  /** 24-hour `HH:MM` label for when the loaded thread starts. */
  time: string;
  /** Total message count for the session, when known. */
  messageCount?: number;
}

/**
 * Thin centered rule at the top of a loaded thread reading
 * `SESSION 14:28 · 18 MESSAGES`. Segments whose data isn't available to the
 * caller (e.g. message count) are omitted rather than shown as a placeholder.
 */
function SessionDivider({ time, messageCount }: SessionDividerProps) {
  const segments = [`SESSION ${time}`];
  if (typeof messageCount === 'number' && messageCount > 0) {
    segments.push(`${messageCount} MESSAGES`);
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1 sm:px-0">
      <div className="h-px flex-1 bg-border" />
      <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        {segments.join(' · ')}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export default memo(SessionDivider);
