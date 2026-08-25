import { useMemo, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';

import { Button, Input } from '../../../shared/view/ui';
import type { ReviewComment } from '../types';
import { groupCommentsByLine, parseReviewDiffLines } from '../utils/reviewDiffLines';

type ReviewDiffViewerProps = {
  diff: string;
  comments: ReviewComment[];
  onAddComment: (input: { lineNo: number | null; body: string }) => Promise<void>;
  isReadOnly: boolean;
};

const LINE_LIMIT = 1_500;

/**
 * Per-file diff with a comment affordance on every line.
 *
 * Line classes mirror the git panel's viewer so a diff reads the same in both
 * places; what this adds is the line number (parsed from the hunk headers) and
 * the inline composer that anchors a comment to it.
 */
export default function ReviewDiffViewer({
  diff,
  comments,
  onAddComment,
  isReadOnly,
}: ReviewDiffViewerProps) {
  const [composerLine, setComposerLine] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const lines = useMemo(() => parseReviewDiffLines(diff), [diff]);
  const commentsByLine = useMemo(() => groupCommentsByLine(comments), [comments]);
  const visibleLines = lines.slice(0, LINE_LIMIT);

  const submit = async (lineNo: number) => {
    const body = draft.trim();
    if (!body || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onAddComment({ lineNo, body });
      setDraft('');
      setComposerLine(null);
    } finally {
      setIsSaving(false);
    }
  };

  if (!diff.trim()) {
    return <div className="p-4 text-center text-sm text-muted-foreground">No diff available</div>;
  }

  return (
    <div className="diff-viewer">
      {lines.length > LINE_LIMIT && (
        <div className="mb-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Large diff preview: only the first {LINE_LIMIT} lines are rendered.
        </div>
      )}

      {visibleLines.map((line, index) => {
        const lineComments = line.newLineNo === null ? [] : commentsByLine.get(line.newLineNo) ?? [];
        const canComment = !isReadOnly && line.newLineNo !== null;

        return (
          <div key={index}>
            <div
              className={`group flex items-start gap-2 px-2 py-0.5 font-mono text-xs ${
                line.kind === 'addition'
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300'
                  : line.kind === 'deletion'
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                    : line.kind === 'hunk'
                      ? 'bg-primary/5 text-primary'
                      : 'text-muted-foreground/70'
              }`}
            >
              <span className="w-10 shrink-0 select-none text-right text-muted-foreground/50">
                {line.newLineNo ?? ''}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{line.text}</span>
              {canComment && (
                <button
                  type="button"
                  aria-label={`Comment on line ${line.newLineNo}`}
                  onClick={() => {
                    setComposerLine(line.newLineNo);
                    setDraft('');
                  }}
                  className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>

            {lineComments.map((comment) => (
              <div
                key={comment.comment_id}
                className="my-1 ml-12 rounded-md border border-border bg-card px-3 py-2 text-xs"
              >
                <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {comment.author === 'agent' ? 'Agent' : 'You'}
                  </span>
                  <span>line {comment.line_no}</span>
                  {comment.state === 'resolved' && <span>· resolved</span>}
                </div>
                <p className="whitespace-pre-wrap break-words">{comment.body}</p>
              </div>
            ))}

            {composerLine !== null && composerLine === line.newLineNo && (
              <div className="my-1 ml-12 flex items-center gap-2">
                <Input
                  autoFocus
                  value={draft}
                  placeholder={`Comment on line ${line.newLineNo}`}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submit(line.newLineNo as number);
                    }
                    if (event.key === 'Escape') {
                      setComposerLine(null);
                    }
                  }}
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  disabled={isSaving || !draft.trim()}
                  onClick={() => void submit(line.newLineNo as number)}
                >
                  Send
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setComposerLine(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
