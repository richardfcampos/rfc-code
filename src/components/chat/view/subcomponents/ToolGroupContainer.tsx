import { useMemo } from 'react';
import { Code2 } from 'lucide-react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, Provider } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { ToolGroupItem } from '../../utils/toolGrouping';
// Row/detail live outside the tools barrel on purpose — the barrel is what
// ToolRenderer consumes, and importing them through it would cycle.
import { ToolCallRow } from '../../tools/components/ToolCallRow';
import { formatToolDuration, getToolRunElapsedMs } from '../../tools/utils/tool-duration';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolGroupContainerProps {
  group: ToolGroupItem;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
}

/**
 * A consecutive run of tool calls rendered as one bordered card: a header
 * stating how many calls it holds plus the run's elapsed wall time, then one
 * row per call. The total is the span from the first call's start to the last
 * result — never a sum of per-call latencies, which would multiply a batch of
 * parallel calls — and it is omitted entirely unless every call in the run
 * carries both timestamps.
 */
export default function ToolGroupContainer({
  group,
  createDiff,
  getMessageKey,
  onFileOpen,
  showRawParameters,
  selectedProject,
}: ToolGroupContainerProps) {
  const elapsedMs = useMemo(() => getToolRunElapsedMs(group.messages), [group.messages]);

  const callCount = group.messages.length;

  return (
    <div className="chat-message tool px-3 sm:px-0" data-message-timestamp={group.timestamp || undefined}>
      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <Code2 className="h-3.5 w-3.5 flex-shrink-0 text-faint" aria-hidden />
          <span className="font-mono text-[11px] tracking-wide text-muted-foreground">
            {callCount} {callCount === 1 ? 'tool call' : 'tool calls'}
          </span>
          {elapsedMs !== null && (
            <span className="ml-auto font-mono text-[10px] tabular-nums tracking-wide text-faint">
              {formatToolDuration(elapsedMs)}
            </span>
          )}
        </div>

        <div className="divide-y divide-border">
          {group.messages.map((message) => (
            <ToolCallRow
              key={getMessageKey(message)}
              message={message}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              selectedProject={selectedProject}
              showRawParameters={showRawParameters}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
