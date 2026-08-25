import type { ReviewComment, ReviewDiffFile } from '../types';

type ReviewFileListProps = {
  files: ReviewDiffFile[];
  comments: ReviewComment[];
  selectedFile: string | null;
  onSelect: (filePath: string) => void;
};

const KIND_LABEL: Record<ReviewDiffFile['changeKind'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  changed: '?',
};

/** The review's changed files, with each file's open comment count. */
export default function ReviewFileList({
  files,
  comments,
  selectedFile,
  onSelect,
}: ReviewFileListProps) {
  if (files.length === 0) {
    return (
      <p className="border-b border-border p-3 text-sm text-muted-foreground md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        This branch has no changes against its base.
      </p>
    );
  }

  return (
    <ul className="max-h-48 overflow-auto border-b border-border p-1 md:max-h-none md:w-64 md:shrink-0 md:border-b-0 md:border-r">
      {files.map((file) => {
        const openComments = comments.filter(
          (comment) => comment.file_path === file.filePath && comment.state === 'open',
        ).length;

        return (
          <li key={file.filePath}>
            <button
              type="button"
              onClick={() => onSelect(file.filePath)}
              className={`flex w-full items-center gap-2 rounded-ctl px-2 py-1.5 text-left text-xs transition-colors ${
                file.filePath === selectedFile
                  ? 'bg-primary/5 text-foreground'
                  : 'text-muted-foreground hover:bg-[var(--hover)]'
              }`}
            >
              <span className="w-3 shrink-0 font-mono">{KIND_LABEL[file.changeKind]}</span>
              <span className="min-w-0 flex-1 truncate font-mono" title={file.filePath}>
                {file.filePath}
              </span>
              {openComments > 0 && (
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">
                  {openComments}
                </span>
              )}
              <span className="shrink-0 text-[10px] text-green-600 dark:text-green-400">
                +{file.additions}
              </span>
              <span className="shrink-0 text-[10px] text-red-600 dark:text-red-400">
                −{file.deletions}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
