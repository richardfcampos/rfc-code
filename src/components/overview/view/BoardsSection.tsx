import type { OverviewBoard } from '../utils/overview-data';

import BoardProjectBlock from './BoardProjectBlock';

type BoardsSectionProps = {
  boards: OverviewBoard[];
  /** Statuses NOT in this set render dimmed; null/undefined dims nothing.
   * Not wired to any filter UI yet — the prop exists so filters can land
   * later without reshaping this component. */
  dimmedColumns?: Set<string> | null;
};

export default function BoardsSection({ boards, dimmedColumns }: BoardsSectionProps) {
  if (boards.length === 0) {
    return <p className="text-sm text-muted-foreground">No project boards</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {boards.map((board) => (
        <BoardProjectBlock key={board.projectId} board={board} dimmedColumns={dimmedColumns} />
      ))}
    </div>
  );
}
