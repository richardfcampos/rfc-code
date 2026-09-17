import { ChevronRight } from 'lucide-react';

import type { GitCompareFile } from '../../types/types';
import { getStatusBadgeClass, getStatusLabel } from '../../utils/gitPanelUtils';
import GitDiffViewer from '../shared/GitDiffViewer';

type CompareFileItemProps = {
  file: GitCompareFile;
  isMobile: boolean;
  isExpanded: boolean;
  /** Undefined until the diff has been fetched; empty string means "no textual change". */
  diff: string | undefined;
  wrapText: boolean;
  onToggleExpanded: (filePath: string) => void;
  onOpenFile: (filePath: string) => void;
};

export default function CompareFileItem({
  file,
  isMobile,
  isExpanded,
  diff,
  wrapText,
  onToggleExpanded,
  onOpenFile,
}: CompareFileItemProps) {
  const badgeClass = getStatusBadgeClass(file.status);

  return (
    <div className="border-b border-border last:border-0">
      <div className={`flex items-center transition-colors hover:bg-accent/50 ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
        <button
          onClick={() => onToggleExpanded(file.path)}
          className={`cursor-pointer rounded p-0.5 hover:bg-accent ${isMobile ? 'mr-1' : 'mr-2'}`}
          title={isExpanded ? 'Collapse diff' : 'Expand diff'}
        >
          <ChevronRight className={`h-3 w-3 transition-transform duration-200 ease-in-out ${isExpanded ? 'rotate-90' : 'rotate-0'}`} />
        </button>

        <span
          className={`min-w-0 flex-1 truncate ${isMobile ? 'text-xs' : 'text-sm'} cursor-pointer hover:text-primary hover:underline`}
          onClick={() => onOpenFile(file.path)}
          title={file.previousPath ? `${file.previousPath} → ${file.path}` : 'Click to open file'}
        >
          {file.previousPath && (
            <span className="text-muted-foreground/60">{file.previousPath} → </span>
          )}
          {file.path}
        </span>

        <span className="ml-2 flex shrink-0 items-center gap-2 font-mono text-xs">
          {file.insertions > 0 && (
            <span className="text-green-600 dark:text-green-400">+{file.insertions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
          )}
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${badgeClass}`}
            title={getStatusLabel(file.status)}
          >
            {file.status}
          </span>
        </span>
      </div>

      {isExpanded && (
        <div className="max-h-96 overflow-y-auto bg-muted/50">
          {diff === undefined ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading diff…</div>
          ) : (
            <GitDiffViewer diff={diff} isMobile={isMobile} wrapText={wrapText} />
          )}
        </div>
      )}
    </div>
  );
}
