import { memo } from 'react';

interface SpeakerLineProps {
  /** Provider/model label, e.g. `Claude`. Rendered in foreground weight. */
  label: string;
  /** 24-hour `HH:MM` turn time. Omitted when unavailable. */
  time?: string;
}

/**
 * Mono metadata line above a turn: `label · time`. Mode/model segments beyond
 * `label` aren't rendered here because no per-turn model or permission-mode
 * data reaches this component today — see MessageComponent's call site.
 */
function SpeakerLine({ label, time }: SpeakerLineProps) {
  return (
    <div className="font-mono text-[11px] tracking-wide">
      <span className="font-medium text-foreground">{label}</span>
      {time && <span className="text-faint"> · {time}</span>}
    </div>
  );
}

export default memo(SpeakerLine);
