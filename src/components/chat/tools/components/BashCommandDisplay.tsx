import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Copy, Check } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { ToolStatusBadge } from './ToolStatusBadge';
import type { ToolStatus } from './ToolStatusBadge';

interface BashCommandDisplayProps {
  command: string;
  description?: string;
  /** Combined stdout/stderr from the tool result (empty while running). */
  output?: string;
  isError?: boolean;
  status?: ToolStatus;
  defaultOpen?: boolean;
}

/**
 * Codex-in-VSCode style command row: a compact, single-line command with a
 * chevron on the left. When the command produced output, the row becomes a
 * dropdown that expands to reveal the output inline. Theme-integrated surfaces
 * keep it clean in both light and dark mode; consecutive commands stack tightly
 * into a clean list.
 */
export const BashCommandDisplay: React.FC<BashCommandDisplayProps> = ({
  command,
  description,
  output,
  isError = false,
  status,
  defaultOpen = false,
}) => {
  const trimmedOutput = (output || '').replace(/\s+$/, '');
  const hasOutput = trimmedOutput.length > 0;
  const outputLineCount = hasOutput ? trimmedOutput.split('\n').length : 0;
  const isRunning = status === 'running';
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Output (and errors) often arrive after this component first mounts, so apply
  // the auto-open intent once when there is finally something to show. After that
  // the user is in control of the toggle.
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (!autoAppliedRef.current && hasOutput && (defaultOpen || isError)) {
      autoAppliedRef.current = true;
      setOpen(true);
    }
  }, [hasOutput, defaultOpen, isError]);

  const toggle = () => {
    if (hasOutput) {
      setOpen((prev) => !prev);
    }
  };

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const didCopy = await copyTextToClipboard(command);
    if (!didCopy) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'group/cmd overflow-hidden rounded-card border bg-card transition-colors duration-150 ease-out',
        isError ? 'border-[var(--danger-line)]' : 'border-border',
        hasOutput && !open && 'hover:border-border-strong hover:bg-[var(--hover-soft)]',
      )}
    >
      {/* Command header — clickable when there is output to expand */}
      <div
        role={hasOutput ? 'button' : undefined}
        tabIndex={hasOutput ? 0 : undefined}
        aria-expanded={hasOutput ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (hasOutput && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 outline-none',
          hasOutput && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 flex-shrink-0 text-faint transition-transform duration-150 ease-out',
            open && 'rotate-90',
            !hasOutput && 'opacity-0',
          )}
        />
        <span className="flex-shrink-0 select-none font-mono text-[11px] font-semibold tracking-wide text-success">
          $
        </span>
        <code
          className={cn(
            'min-w-0 flex-1 font-mono text-[11px] tracking-wide text-foreground',
            open ? 'whitespace-pre-wrap break-all' : 'truncate',
          )}
        >
          {command}
        </code>

        {isRunning && (
          <span className="h-2.5 w-2.5 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-primary" />
        )}
        {status && status !== 'running' && <ToolStatusBadge status={status} className="flex-shrink-0" />}
        {!open && hasOutput && !isRunning && (
          <span className="flex-shrink-0 font-mono text-[10px] tabular-nums tracking-wide text-faint transition-opacity duration-150 ease-out group-hover/cmd:opacity-0">
            {outputLineCount} {outputLineCount === 1 ? 'line' : 'lines'}
          </span>
        )}

        <button
          onClick={handleCopy}
          onKeyDown={(event) => event.stopPropagation()}
          className="flex-shrink-0 rounded-ctl p-0.5 text-faint opacity-0 transition-all duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/cmd:opacity-100"
          title="Copy command"
          aria-label="Copy command"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>

      {description && !open && (
        <div className="truncate px-2.5 pb-1.5 pl-[2.4rem] text-[11px] italic text-faint">
          {description}
        </div>
      )}

      {/* Expanded output */}
      {open && hasOutput && (
        <div className="settings-content-enter border-t border-border bg-background">
          {description && (
            <div className="px-3 pt-2 text-[11px] italic text-faint">{description}</div>
          )}
          <pre
            className={cn(
              'max-h-80 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-[1.75] tracking-wide',
              isError ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {trimmedOutput}
          </pre>
        </div>
      )}
    </div>
  );
};
