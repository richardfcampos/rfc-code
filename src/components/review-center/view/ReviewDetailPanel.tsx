import { useCallback, useEffect, useState } from 'react';
import { Check, GitBranch, RotateCcw } from 'lucide-react';

import { Button } from '../../../shared/view/ui';
import type { ReviewCommentRouting } from '../types';
import { useReviewDetail } from '../hooks/useReviewDetail';

import ReviewDiffViewer from './ReviewDiffViewer';
import ReviewFileList from './ReviewFileList';

type ReviewDetailPanelProps = {
  reviewId: string;
  onResolved: () => void;
};

/** Turns a routing outcome into the one line the reviewer needs to read. */
function describeRouting(routing: ReviewCommentRouting | null): string {
  if (!routing) {
    return 'Saved.';
  }
  switch (routing.status) {
    case 'delivered':
      return 'Sent to the agent working on this branch.';
    case 'session_busy':
      return 'Saved — the agent session is mid-run, so it was not sent.';
    case 'no_session':
      return 'Saved — no session is working on this branch.';
    case 'not_configured':
      return 'Saved — no provider runtime is available to notify the agent.';
    default:
      return 'Saved — notifying the agent failed.';
  }
}

export default function ReviewDetailPanel({ reviewId, onResolved }: ReviewDetailPanelProps) {
  const { detail, isLoading, loadError, loadFileDiff, addComment, approve, requestChanges } =
    useReviewDetail(reviewId);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [diffError, setDiffError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);

  // A new review resets the file selection; the first file is a useful default.
  useEffect(() => {
    setSelectedFile(detail?.files[0]?.filePath ?? null);
    setNotice(null);
  }, [detail]);

  useEffect(() => {
    if (!selectedFile) {
      setDiff('');
      return;
    }
    let cancelled = false;
    setDiffError(null);
    loadFileDiff(selectedFile)
      .then((loaded) => {
        if (!cancelled) {
          setDiff(loaded);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDiff('');
          setDiffError(error instanceof Error ? error.message : 'Failed to load the diff');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFile, loadFileDiff]);

  const handleAddComment = useCallback(
    async ({ lineNo, body }: { lineNo: number | null; body: string }) => {
      if (!selectedFile) {
        return;
      }
      const { routing } = await addComment({ filePath: selectedFile, lineNo, body });
      setNotice(describeRouting(routing));
    },
    [addComment, selectedFile],
  );

  const handleApprove = async () => {
    setIsActing(true);
    setNotice(null);
    try {
      const result = await approve();
      setNotice(
        `Merged ${result.merge.mergedBranch} into ${result.merge.targetBranch}. Task moved to Done.`,
      );
      onResolved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The merge failed');
    } finally {
      setIsActing(false);
    }
  };

  const handleRequestChanges = async () => {
    const summary = window.prompt('What should the agent change?') ?? '';
    setIsActing(true);
    try {
      const result = await requestChanges(summary);
      setNotice(summary ? describeRouting(result.routing) : 'Changes requested.');
      onResolved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not request changes');
    } finally {
      setIsActing(false);
    }
  };

  if (isLoading && !detail) {
    return <p className="p-4 text-sm text-muted-foreground">Loading the review…</p>;
  }
  if (loadError) {
    return <p className="p-4 text-sm text-destructive">{loadError}</p>;
  }
  if (!detail) {
    return null;
  }

  const isReadOnly = detail.review.state !== 'open' && detail.review.state !== 'changes_requested';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-foreground">{detail.task.title}</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {detail.worktree.branch} → {detail.worktree.baseBranch}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" disabled={isActing || isReadOnly} onClick={() => void handleRequestChanges()}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Request changes
          </Button>
          <Button size="sm" disabled={isActing || isReadOnly} onClick={() => void handleApprove()}>
            <Check className="mr-1 h-3.5 w-3.5" />
            Approve &amp; merge
          </Button>
        </div>
      </header>

      {notice && (
        <p className="border-b border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ReviewFileList
          files={detail.files}
          comments={detail.comments}
          selectedFile={selectedFile}
          onSelect={setSelectedFile}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {diffError ? (
            <p className="p-4 text-sm text-destructive">{diffError}</p>
          ) : (
            <ReviewDiffViewer
              diff={diff}
              comments={detail.comments.filter((comment) => comment.file_path === selectedFile)}
              onAddComment={handleAddComment}
              isReadOnly={isReadOnly}
            />
          )}
        </div>
      </div>
    </div>
  );
}
