import { useEffect, useState } from 'react';
import { GitPullRequest } from 'lucide-react';

import type { Project } from '../../../types/app';
import { useReviewQueue } from '../hooks/useReviewQueue';

import ReviewDetailPanel from './ReviewDetailPanel';
import ReviewQueueList from './ReviewQueueList';

type ReviewCenterTabProps = {
  selectedProject: Project | null;
};

/**
 * The Review Center: the queue of tasks waiting on a human on the left, the
 * selected review's diff and conversation on the right (stacked on narrow
 * screens, since reviewing on a tablet is the target flow).
 */
export default function ReviewCenterTab({ selectedProject }: ReviewCenterTabProps) {
  const projectId = selectedProject?.projectId;
  const { reviews, isLoading, loadError, reload } = useReviewQueue(projectId);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  // A project switch invalidates any selection from the previous queue.
  useEffect(() => {
    setSelectedReviewId(null);
  }, [projectId]);

  // A review that left the queue (approved elsewhere, task deleted) must not
  // stay open in the detail pane.
  useEffect(() => {
    if (selectedReviewId && !reviews.some((review) => review.review_id === selectedReviewId)) {
      setSelectedReviewId(null);
    }
  }, [reviews, selectedReviewId]);

  if (!selectedProject) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <GitPullRequest className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Select a project to see its review queue.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="max-h-56 shrink-0 overflow-auto border-b border-border md:max-h-none md:w-72 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reviews
          </h2>
          {isLoading && <span className="text-xs text-muted-foreground">loading…</span>}
        </div>
        {loadError ? (
          <p className="px-3 pb-3 text-sm text-destructive">Failed to load the review queue.</p>
        ) : (
          <ReviewQueueList
            reviews={reviews}
            selectedReviewId={selectedReviewId}
            onSelect={setSelectedReviewId}
          />
        )}
      </aside>

      <section className="min-h-0 flex-1 overflow-hidden">
        {selectedReviewId ? (
          <ReviewDetailPanel
            key={selectedReviewId}
            reviewId={selectedReviewId}
            onResolved={() => {
              setSelectedReviewId(null);
              void reload();
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Pick a review to see its diff and leave comments.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
