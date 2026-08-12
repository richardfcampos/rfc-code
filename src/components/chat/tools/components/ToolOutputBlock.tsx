import React, { useMemo, useState } from 'react';

import { cn } from '../../../../lib/utils';

interface ToolOutputBlockProps {
  text: string;
  isError?: boolean;
  /** Rows shown before the `N more lines` footer takes over. */
  previewLines?: number;
}

interface OutputLine {
  number: number;
  content: string;
}

const NUMBERED_LINE = /^\s*(\d+)\t(.*)$/;

/**
 * Tools such as Read and `grep -n` already prefix each row with its real file
 * line number. Reusing those numbers keeps the gutter meaningful instead of
 * printing a second, redundant counter next to them.
 */
function parseOutputLines(text: string): OutputLine[] {
  const rawLines = text.replace(/\s+$/, '').split('\n');
  const parsed = rawLines.map((line) => NUMBERED_LINE.exec(line));
  const matched = parsed.filter(Boolean).length;
  const nonEmpty = rawLines.filter((line) => line.trim()).length;
  const useOwnNumbers = nonEmpty > 0 && matched >= Math.ceil(nonEmpty * 0.8);

  return rawLines.map((line, index) => {
    const match = parsed[index];
    if (useOwnNumbers && match) {
      return { number: Number(match[1]), content: match[2] };
    }
    return { number: index + 1, content: useOwnNumbers ? line.replace(/^\s*\d+\t/, '') : line };
  });
}

/**
 * Terminal-style output: monospace rows, line numbers in a faint gutter and a
 * footer that reveals the rest of a truncated run.
 */
export const ToolOutputBlock: React.FC<ToolOutputBlockProps> = ({
  text,
  isError = false,
  previewLines = 12,
}) => {
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(() => parseOutputLines(text), [text]);

  if (lines.length === 0 || (lines.length === 1 && !lines[0].content)) {
    return null;
  }

  const visible = showAll ? lines : lines.slice(0, previewLines);
  const hiddenCount = lines.length - visible.length;
  const gutterWidth = String(lines[lines.length - 1]?.number ?? 0).length;

  return (
    <div className="bg-background py-1.5">
      <div className="max-h-80 overflow-auto font-mono text-[11px] leading-[1.75] tracking-wide">
        {visible.map((line, index) => (
          <div key={`${line.number}-${index}`} className="flex gap-3 px-3">
            <span
              className="flex-shrink-0 select-none text-right tabular-nums text-faint"
              style={{ width: `${Math.max(gutterWidth, 2)}ch` }}
              aria-hidden
            >
              {line.number}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 whitespace-pre-wrap break-all',
                isError ? 'text-danger' : 'text-muted-foreground',
              )}
            >
              {line.content}
            </span>
          </div>
        ))}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-0.5 rounded-ctl px-3 font-mono text-[10px] tabular-nums tracking-wide text-faint transition-colors duration-150 ease-out hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {hiddenCount} more {hiddenCount === 1 ? 'line' : 'lines'}
        </button>
      )}
    </div>
  );
};
