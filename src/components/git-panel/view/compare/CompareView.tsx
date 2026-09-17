import { GitCompare, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Project } from '../../../../types/app';
import { useCompareController } from '../../hooks/useCompareController';
import { useWorktreesController } from '../../hooks/useWorktreesController';
import type { CompareTarget, WorktreeInfo } from '../../types/types';

import CompareFileItem from './CompareFileItem';
import CompareTargetPicker from './CompareTargetPicker';

type CompareViewProps = {
  isMobile: boolean;
  selectedProject: Project | null;
  currentBranch: string;
  localBranches: string[];
  remoteBranches: string[];
  remoteName: string;
  wrapText: boolean;
  onOpenFile: (filePath: string) => void;
};

function shortWorktreePath(worktreePath: string): string {
  const segments = worktreePath.split(/[\\/]/).filter(Boolean);
  return segments.slice(-2).join('/') || worktreePath;
}

/** A worktree compares as its HEAD: the branch when it has one, the commit otherwise. */
function worktreeTarget(worktree: WorktreeInfo): CompareTarget | null {
  const ref = worktree.branch ?? worktree.headSha;
  if (!ref) {
    return null;
  }
  return {
    kind: 'worktree',
    ref,
    label: worktree.branch ?? `detached @ ${ref.slice(0, 7)}`,
    detail: shortWorktreePath(worktree.path),
  };
}

/**
 * "What did this checkout change compared to X" where X is any branch or any
 * other worktree of the repository. Measured from the merge base, so commits
 * that only landed on X are not shown as reversals here.
 */
export default function CompareView({
  isMobile,
  selectedProject,
  currentBranch,
  localBranches,
  remoteBranches,
  remoteName,
  wrapText,
  onOpenFile,
}: CompareViewProps) {
  const { worktreeData } = useWorktreesController({ selectedProject });
  const [target, setTarget] = useState<CompareTarget | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const { result, isLoading, error, diffs, refresh, fetchFileDiff } = useCompareController({
    selectedProject,
    target,
  });

  const worktreeTargets = useMemo(
    () =>
      (worktreeData?.worktrees ?? [])
        .filter((worktree) => !worktree.isCurrent)
        .map(worktreeTarget)
        .filter((candidate): candidate is CompareTarget => candidate !== null),
    [worktreeData],
  );

  const branchTargets = useMemo<CompareTarget[]>(
    () => [
      ...localBranches
        .filter((branch) => branch !== currentBranch)
        .map((branch) => ({ kind: 'branch' as const, ref: branch, label: branch })),
      ...remoteBranches.map((branch) => ({
        kind: 'branch' as const,
        ref: `${remoteName}/${branch}`,
        label: `${remoteName}/${branch}`,
      })),
    ],
    [currentBranch, localBranches, remoteBranches, remoteName],
  );

  // Default to the main worktree — the usual "what did my worktree do" question.
  useEffect(() => {
    if (target || !worktreeData) {
      return;
    }
    const mainWorktree = worktreeData.worktrees.find((worktree) => worktree.isMain && !worktree.isCurrent);
    const fallback = mainWorktree ? worktreeTarget(mainWorktree) : null;
    if (fallback) {
      setTarget(fallback);
    }
  }, [target, worktreeData]);

  // Expanded rows belong to the previous comparison once the target changes.
  useEffect(() => {
    setExpandedFiles(new Set());
  }, [target]);

  const toggleFileExpanded = useCallback(
    (filePath: string) => {
      const isExpanding = !expandedFiles.has(filePath);
      setExpandedFiles((previous) => {
        const next = new Set(previous);
        if (next.has(filePath)) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }
        return next;
      });
      if (isExpanding && diffs[filePath] === undefined) {
        void fetchFileDiff(filePath);
      }
    },
    [diffs, expandedFiles, fetchFileDiff],
  );

  const totals = useMemo(() => {
    const files = result?.files ?? [];
    return {
      files: files.length,
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    };
  }, [result]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className={`flex flex-wrap items-center gap-2 border-b border-border/40 ${isMobile ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{currentBranch || 'HEAD'}</span> vs
        </span>
        <CompareTargetPicker
          isMobile={isMobile}
          selected={target}
          worktreeTargets={worktreeTargets}
          branchTargets={branchTargets}
          onSelect={setTarget}
        />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {result && (
            <>
              {result.ahead > 0 && (
                <span className="text-green-600 dark:text-green-400" title={`${result.ahead} commits ahead of ${result.base}`}>
                  ↑{result.ahead}
                </span>
              )}
              {result.behind > 0 && (
                <span className="text-primary" title={`${result.behind} commits behind ${result.base}`}>
                  ↓{result.behind}
                </span>
              )}
              <span className="font-mono">
                {totals.files} file{totals.files === 1 ? '' : 's'}
                {' '}
                <span className="text-green-600 dark:text-green-400">+{totals.insertions}</span>
                {' '}
                <span className="text-red-600 dark:text-red-400">-{totals.deletions}</span>
              </span>
            </>
          )}
          <button
            onClick={() => void refresh()}
            disabled={!target || isLoading}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Refresh comparison"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!target ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <GitCompare className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">Choose a branch or worktree to compare with</p>
          </div>
        ) : isLoading && !result ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : result && result.files.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <GitCompare className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">No differences from {target.label}</p>
          </div>
        ) : (
          <div className={isMobile ? 'pb-4' : ''}>
            {(result?.files ?? []).map((file) => (
              <CompareFileItem
                key={file.path}
                file={file}
                isMobile={isMobile}
                isExpanded={expandedFiles.has(file.path)}
                diff={diffs[file.path]}
                wrapText={wrapText}
                onToggleExpanded={toggleFileExpanded}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
