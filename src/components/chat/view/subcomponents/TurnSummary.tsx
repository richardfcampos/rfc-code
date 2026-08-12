import { memo } from 'react';

interface TurnSummaryProps {
  additions: number;
  deletions: number;
  fileCount: number;
}

/**
 * Trailing mono line under an assistant turn that touched files, e.g.
 * `+38 -12 3 files`. Rendered only when the turn has file-edit stats — see
 * `computeTurnFileStats` for how those are derived and when they're omitted.
 */
function TurnSummary({ additions, deletions, fileCount }: TurnSummaryProps) {
  return (
    <div className="flex items-center gap-2 px-3 pt-0.5 font-mono text-[11px] tracking-wide sm:px-0">
      <span className="text-success">+{additions}</span>
      <span className="text-danger">-{deletions}</span>
      <span className="text-faint">
        {fileCount} {fileCount === 1 ? 'file' : 'files'}
      </span>
    </div>
  );
}

export default memo(TurnSummary);
