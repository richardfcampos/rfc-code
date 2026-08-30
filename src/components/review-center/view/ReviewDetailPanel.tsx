import { useCallback, useEffect, useState } from 'react';
import { Check, GitBranch, RotateCcw, Sparkles } from 'lucide-react';

import { Button } from '../../../shared/view/ui';
import UatPreviewSection from '../../task-master/view/review-cockpit/UatPreviewSection';
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
  const {
    detail,
    isLoading,
    loadError,
    loadFileDiff,
    addComment,
    generateBrief,
    approve,
    requestChanges,
  } = useReviewDetail(reviewId);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [diffError, setDiffError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [isBriefOpen, setIsBriefOpen] = useState(true);
  const [isRequestingChanges, setIsRequestingChanges] = useState(false);
  const [changesDraft, setChangesDraft] = useState('');

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
    const summary = changesDraft.trim();
    setIsActing(true);
    try {
      const result = await requestChanges(summary);
      setNotice(summary ? describeRouting(result.routing) : 'Changes requested.');
      setChangesDraft('');
      setIsRequestingChanges(false);
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
          <Button
            size="sm"
            variant="outline"
            disabled={isActing || isReadOnly}
            onClick={() => setIsRequestingChanges((open) => !open)}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Request changes
          </Button>
          <Button size="sm" disabled={isActing || isReadOnly} onClick={() => void handleApprove()}>
            <Check className="mr-1 h-3.5 w-3.5" />
            Approve &amp; merge
          </Button>
        </div>
      </header>

      {isRequestingChanges && (
        <div className="flex items-start gap-2 border-b border-border bg-card p-3">
          <textarea
            autoFocus
            rows={2}
            value={changesDraft}
            placeholder="What should the agent change? (optional — sent to its session)"
            onChange={(event) => setChangesDraft(event.target.value)}
            className="min-w-0 flex-1 resize-y rounded-ctl border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="sm" disabled={isActing} onClick={() => void handleRequestChanges()}>
            Send
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setIsRequestingChanges(false)}>
            Cancel
          </Button>
        </div>
      )}

      {notice && (
        <p className="border-b border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}

      {/* AI brief: what changed / risks / UAT checklist, generated from the
          branch diff and stored on the review. Evidence, never a gate. */}
      <div className="border-b border-border bg-card px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <button
            className="flex items-center gap-1.5 text-xs font-medium text-foreground"
            onClick={() => setIsBriefOpen((open) => !open)}
          >
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            Resumo da IA
          </button>
          <Button
            size="sm"
            variant="outline"
            disabled={isGeneratingBrief}
            onClick={() => {
              setIsGeneratingBrief(true);
              setBriefError(null);
              generateBrief()
                .then(() => setIsBriefOpen(true))
                .catch((error: unknown) =>
                  setBriefError(error instanceof Error ? error.message : 'Falha ao gerar o resumo'),
                )
                .finally(() => setIsGeneratingBrief(false));
            }}
          >
            {isGeneratingBrief
              ? 'Gerando…'
              : detail.review.ai_brief
                ? 'Regenerar'
                : 'Gerar resumo'}
          </Button>
        </div>
        {briefError && <p className="mt-1 text-xs text-destructive">{briefError}</p>}
        {isBriefOpen && detail.review.ai_brief && (
          <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
            {detail.review.ai_brief}
          </pre>
        )}
        {isBriefOpen && !detail.review.ai_brief && !isGeneratingBrief && !briefError && (
          <p className="mt-1 text-xs text-muted-foreground">
            Sem resumo ainda — gere um pra ver o que mudou, riscos e o checklist de UAT.
          </p>
        )}
      </div>

      {/* Hands-on UAT: boots the task's worktree (not the project root), so
          the URL serves exactly the branch under review. */}
      <div className="border-b border-border">
        <UatPreviewSection
          projectPath={detail.worktree.repositoryRoot}
          cwd={detail.worktree.worktreePath}
        />
      </div>

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
