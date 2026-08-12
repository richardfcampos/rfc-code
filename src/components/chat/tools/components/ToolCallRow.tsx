import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import type { ChatMessage } from '../../types/types';
import { getToolCallSummary, parseToolInput } from '../utils/tool-call-summary';
import { getToolDiffStats, type ToolDiffCalculator } from '../utils/tool-diff-stats';
import { formatToolDuration, getToolCallDurationMs } from '../utils/tool-duration';
import { deriveToolStatus } from '../utils/tool-status';

import type { ToolStatus } from './ToolStatusBadge';
import { ToolCallDetail } from './ToolCallDetail';

interface ToolCallRowProps {
  message: ChatMessage;
  createDiff: ToolDiffCalculator;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  selectedProject?: Project | null;
  showRawParameters?: boolean;
}

const STATUS_DOT: Record<ToolStatus, { className: string; label: string }> = {
  running: { className: 'bg-primary animate-pulse', label: 'Running' },
  completed: { className: 'bg-success', label: 'Completed' },
  error: { className: 'bg-danger', label: 'Error' },
  denied: { className: 'bg-warning', label: 'Denied' },
};

/**
 * One line of the tool-call card: chevron, tool name, primary argument, and a
 * right-aligned status dot with the call's measured duration. Expanding it
 * reveals the call's output.
 */
export const ToolCallRow: React.FC<ToolCallRowProps> = ({
  message,
  createDiff,
  onFileOpen,
  selectedProject,
  showRawParameters,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const input = useMemo(() => parseToolInput(message.toolInput), [message.toolInput]);
  const summary = useMemo(
    () => getToolCallSummary(message, input, selectedProject?.fullPath),
    [message, input, selectedProject?.fullPath],
  );
  const diffStats = useMemo(() => getToolDiffStats(message, input, createDiff), [message, input, createDiff]);

  const status = deriveToolStatus(message.toolResult);
  const dot = STATUS_DOT[status];
  const durationMs = getToolCallDurationMs(message);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
        className="group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-[var(--hover-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 flex-shrink-0 text-faint transition-transform duration-150 ease-out',
            isExpanded && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="flex-shrink-0 font-mono text-[11px] font-semibold tracking-wide text-foreground">
          {summary.label}
        </span>
        <span className="min-w-0 truncate font-mono text-[11px] tracking-wide text-muted-foreground" title={summary.primary}>
          {summary.primary}
        </span>

        {summary.detail && (
          <span className="flex-shrink-0 font-mono text-[11px] tracking-wide text-faint">
            <span aria-hidden>· </span>
            {summary.detail}
          </span>
        )}

        {diffStats && (
          <span className="flex-shrink-0 font-mono text-[11px] tabular-nums tracking-wide">
            <span className="text-faint" aria-hidden>· </span>
            <span className="text-success">+{diffStats.added}</span>{' '}
            <span className="text-danger">-{diffStats.removed}</span>
          </span>
        )}

        <span className="ml-auto flex flex-shrink-0 items-center gap-2 pl-2">
          <span className={cn('h-1.5 w-1.5 rounded-full', dot.className)} aria-hidden />
          <span className="sr-only">{dot.label}</span>
          {durationMs !== null && (
            <span className="w-9 text-right font-mono text-[10px] tabular-nums tracking-wide text-faint">
              {formatToolDuration(durationMs)}
            </span>
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="settings-content-enter border-t border-border">
          <ToolCallDetail
            message={message}
            input={input}
            createDiff={createDiff}
            onFileOpen={onFileOpen}
            selectedProject={selectedProject}
            showRawParameters={showRawParameters}
          />
        </div>
      )}
    </div>
  );
};
