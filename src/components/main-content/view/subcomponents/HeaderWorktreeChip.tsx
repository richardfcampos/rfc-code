import { GitBranch } from 'lucide-react';

import type { ProjectSession } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import { getSessionWorktreeLabel } from '../../../sidebar/utils/utils';

type HeaderWorktreeChipProps = {
  selectedSession: ProjectSession | null;
  className?: string;
};

/**
 * `wt/<branch>` chip for the header's right cluster. Renders nothing when the
 * active session has no worktree — reuses the sidebar's label derivation
 * (branch name, falling back to the worktree path basename) so the two badges
 * never disagree.
 */
export default function HeaderWorktreeChip({ selectedSession, className = '' }: HeaderWorktreeChipProps) {
  const worktreeLabel = selectedSession ? getSessionWorktreeLabel(selectedSession) : null;

  if (!worktreeLabel) {
    return null;
  }

  return (
    <span
      title={`wt/${worktreeLabel}`}
      className={cn(
        'inline-flex min-w-0 max-w-[200px] items-center gap-1.5 rounded-ctl border border-border px-2 py-1 font-mono text-[11px] leading-none text-muted-foreground',
        className,
      )}
    >
      <GitBranch className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">wt/{worktreeLabel}</span>
    </span>
  );
}
