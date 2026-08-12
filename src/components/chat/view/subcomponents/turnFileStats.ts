import type { ChatMessage } from '../../types/types';
import { parseToolInput } from '../../tools/utils/tool-call-summary';
import { DIFF_TOOL_NAMES, getToolDiffStats, type ToolDiffCalculator } from '../../tools/utils/tool-diff-stats';

export interface TurnFileStats {
  additions: number;
  deletions: number;
  fileCount: number;
}

/** `NotebookEdit` names its target `notebook_path`; every other edit tool uses `file_path`. */
const FILE_PATH_KEYS = ['file_path', 'notebook_path'];

function readFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  for (const key of FILE_PATH_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) {
      return value;
    }
  }

  return null;
}

/**
 * Aggregates additions/deletions/file count across the file-editing tool calls
 * in one assistant turn. Counting is delegated to `getToolDiffStats` — the same
 * function each tool row renders its own `+31 -9` from, over the same tool set
 * (`DIFF_TOOL_NAMES`) — so this trailing summary and the rows above it read
 * from one source and cannot disagree.
 *
 * A tool call is skipped (not counted as 0) when it errored, names no file, or
 * yields no countable change, rather than guessing at its impact. Returns null
 * when no turn message touched a file, so callers can omit the summary line
 * entirely.
 */
export function computeTurnFileStats(
  turnMessages: ChatMessage[],
  createDiff: ToolDiffCalculator,
): TurnFileStats | null {
  let additions = 0;
  let deletions = 0;
  const files = new Set<string>();

  for (const message of turnMessages) {
    if (!message.isToolUse || !message.toolName || !DIFF_TOOL_NAMES.has(message.toolName)) {
      continue;
    }
    if (message.toolResult?.isError) {
      continue;
    }

    const input = parseToolInput(message.toolInput);
    const filePath = readFilePath(input);
    if (!filePath) {
      continue;
    }

    const stats = getToolDiffStats(message, input, createDiff);
    if (!stats) {
      continue;
    }

    additions += stats.added;
    deletions += stats.removed;
    files.add(filePath);
  }

  if (files.size === 0) {
    return null;
  }

  return { additions, deletions, fileCount: files.size };
}
