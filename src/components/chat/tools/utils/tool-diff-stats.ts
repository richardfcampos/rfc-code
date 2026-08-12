import type { ChatMessage } from '../../types/types';

/**
 * Structural shape of the memoised diff calculator the chat thread builds with
 * `createCachedDiffCalculator`. Kept structural so the existing, looser
 * component prop types stay assignable.
 */
export type ToolDiffCalculator = (
  oldStr: string,
  newStr: string,
) => { type: string; content: string; lineNum: number }[];

export interface ToolDiffStats {
  added: number;
  removed: number;
}

/** Tools whose input describes a file mutation we can count lines for. */
export const DIFF_TOOL_NAMES = new Set(['Edit', 'MultiEdit', 'Write', 'ApplyPatch', 'NotebookEdit']);

type PatchHunk = { lines?: unknown };

function readStructuredPatch(toolUseResult: unknown): PatchHunk[] | null {
  if (!toolUseResult || typeof toolUseResult !== 'object') {
    return null;
  }

  const patch = (toolUseResult as { structuredPatch?: unknown }).structuredPatch;
  return Array.isArray(patch) && patch.length > 0 ? (patch as PatchHunk[]) : null;
}

/** Counts the +/- rows the provider already computed for the edit. */
function statsFromPatch(patch: PatchHunk[]): ToolDiffStats {
  let added = 0;
  let removed = 0;

  for (const hunk of patch) {
    if (!Array.isArray(hunk.lines)) continue;
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  }

  return { added, removed };
}

function statsFromDiff(oldText: string, newText: string, createDiff: ToolDiffCalculator): ToolDiffStats {
  let added = 0;
  let removed = 0;

  for (const line of createDiff(oldText, newText)) {
    if (line.type === 'removed') removed += 1;
    else added += 1;
  }

  return { added, removed };
}

function readString(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/** Falls back to the shared diff calculator when no structured patch shipped. */
function statsFromInput(toolName: string, input: unknown, createDiff: ToolDiffCalculator): ToolDiffStats | null {
  if (toolName === 'Write') {
    const content = readString(input, 'content');
    return content === null ? null : statsFromDiff('', content, createDiff);
  }

  if (toolName === 'MultiEdit') {
    const edits = (input as { edits?: unknown } | null)?.edits;
    if (!Array.isArray(edits)) return null;

    return edits.reduce<ToolDiffStats>((total, edit) => {
      const oldText = readString(edit, 'old_string');
      const newText = readString(edit, 'new_string');
      if (oldText === null && newText === null) return total;
      const stats = statsFromDiff(oldText ?? '', newText ?? '', createDiff);
      return { added: total.added + stats.added, removed: total.removed + stats.removed };
    }, { added: 0, removed: 0 });
  }

  const oldText = readString(input, 'old_string');
  const newText = readString(input, 'new_string');
  if (oldText === null && newText === null) return null;

  return statsFromDiff(oldText ?? '', newText ?? '', createDiff);
}

/**
 * `+31 -9` for a file-mutating call. Prefers the provider's structured patch and
 * otherwise reuses the memoised diff calculator that the thread already builds.
 * Returns null when neither source yields a real change, so a row never shows
 * invented numbers.
 */
export function getToolDiffStats(
  message: ChatMessage,
  input: unknown,
  createDiff: ToolDiffCalculator,
): ToolDiffStats | null {
  const toolName = message.toolName || '';
  if (!DIFF_TOOL_NAMES.has(toolName)) {
    return null;
  }

  const patch = readStructuredPatch(message.toolResult?.toolUseResult);
  const stats = patch ? statsFromPatch(patch) : statsFromInput(toolName, input, createDiff);

  if (!stats || (stats.added === 0 && stats.removed === 0)) {
    return null;
  }

  return stats;
}
