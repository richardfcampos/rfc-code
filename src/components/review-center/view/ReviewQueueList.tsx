import { GitBranch, MessageSquare } from 'lucide-react';

import type { ReviewQueueEntry } from '../types';

type ReviewQueueListProps = {
  reviews: ReviewQueueEntry[];
  selectedReviewId: string | null;
  onSelect: (reviewId: string) => void;
};

/** The waiting-on-a-human list; one card per review, newest activity first. */
export default function ReviewQueueList({
  reviews,
  selectedReviewId,
  onSelect,
}: ReviewQueueListProps) {
  if (reviews.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Nothing waiting on you. A task with a worktree opens a review when it reaches the Review
        column.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1 p-2">
      {reviews.map((review) => {
        const isSelected = review.review_id === selectedReviewId;
        return (
          <li key={review.review_id}>
            <button
              type="button"
              onClick={() => onSelect(review.review_id)}
              className={`w-full rounded-ctl border px-3 py-2 text-left transition-colors ${
                isSelected
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border hover:bg-[var(--hover)]'
              }`}
            >
              <p className="truncate text-sm font-medium text-foreground">{review.task_title}</p>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                {review.task_worktree_branch && (
                  <span className="flex min-w-0 items-center gap-1">
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="truncate">{review.task_worktree_branch}</span>
                  </span>
                )}
                {review.state === 'changes_requested' && (
                  <span className="flex shrink-0 items-center gap-1 text-amber-600 dark:text-amber-400">
                    <MessageSquare className="h-3 w-3" />
                    changes requested
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
