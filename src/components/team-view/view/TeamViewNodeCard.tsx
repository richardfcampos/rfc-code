import { PROVIDER_LABELS } from '../../profiles/view/providerLabels';
import { Tooltip } from '../../../shared/view/ui';
import { NODE_HEIGHT, NODE_WIDTH } from '../utils/teamViewLayout';
import { sessionStateDotClassName } from '../utils/teamViewStateStyles';
import type { TeamViewSession } from '../types';

type TeamViewNodeCardProps = {
  session: TeamViewSession;
  x: number;
  y: number;
  profileName: string | null;
  onOpen: (sessionId: string) => void;
};

/** `startedAt` (epoch ms) as a short "Xm/Xh ago" label, floored to whole units. */
function elapsedLabel(startedAt: number): string {
  const elapsedMs = Date.now() - startedAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '';
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function TeamViewNodeCard({ session, x, y, profileName, onOpen }: TeamViewNodeCardProps) {
  const accountLabel = profileName
    ? `${PROVIDER_LABELS[session.provider]} · ${profileName}`
    : PROVIDER_LABELS[session.provider];

  return (
    <Tooltip content={session.taskTitle ?? accountLabel} position="top">
      <button
        type="button"
        onClick={() => onOpen(session.sessionId)}
        className="absolute flex flex-col justify-between gap-1 rounded-ctl border border-border bg-card p-2.5 text-left shadow-[var(--shadow-float)] transition-colors duration-150 ease-out hover:border-primary/60 hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <span
            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${sessionStateDotClassName(session.state)}`}
            aria-hidden="true"
          />
          <span className="truncate">{accountLabel}</span>
          {session.usagePct !== null && (
            <span className="ml-auto flex-shrink-0 text-[10px] text-muted-foreground">
              {Math.round(session.usagePct)}%
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {session.taskTitle ?? 'No task assigned'}
        </div>
        <div className="text-[10px] text-muted-foreground">{elapsedLabel(session.startedAt)}</div>
      </button>
    </Tooltip>
  );
}
