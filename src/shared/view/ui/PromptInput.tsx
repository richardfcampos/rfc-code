"use client";

import * as React from 'react';
import { SendHorizonalIcon, SquareIcon } from 'lucide-react';

import { cn } from '../../../lib/utils';

import { Button } from './Button';
import Tooltip from './Tooltip';

/* ─── Context ────────────────────────────────────────────────────── */

type PromptInputStatus = 'ready' | 'submitted' | 'streaming' | 'error';

interface PromptInputContextValue {
  status: PromptInputStatus;
}

const PromptInputContext = React.createContext<PromptInputContextValue | null>(null);

const usePromptInput = () => {
  const context = React.useContext(PromptInputContext);
  if (!context) {
    throw new Error('PromptInput components must be used within PromptInput');
  }
  return context;
};

/* ─── PromptInput (root form) ────────────────────────────────────── */

export interface PromptInputProps extends React.FormHTMLAttributes<HTMLFormElement> {
  status?: PromptInputStatus;
}

export const PromptInput = React.forwardRef<HTMLFormElement, PromptInputProps>(
  ({ className, status = 'ready', children, ...props }, ref) => {
    const contextValue = React.useMemo(() => ({ status }), [status]);

    return (
      <PromptInputContext.Provider value={contextValue}>
        <form
          ref={ref}
          data-slot="prompt-input"
          className={cn(
            // The composer is the cockpit: one calm surface, a single hairline that
            // firms up on focus. Elevation comes from the float shadow, never a ring.
            'relative overflow-hidden rounded-composer border border-border bg-card shadow-[var(--shadow-float)] transition-colors duration-150 ease-out focus-within:border-border-strong',
            className
          )}
          {...props}
        >
          {children}
        </form>
      </PromptInputContext.Provider>
    );
  }
);
PromptInput.displayName = 'PromptInput';

/* ─── PromptInputHeader ──────────────────────────────────────────── */

export const PromptInputHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-header"
    className={cn('px-3 pt-3', className)}
    {...props}
  />
));
PromptInputHeader.displayName = 'PromptInputHeader';

/* ─── PromptInputBody ────────────────────────────────────────────── */

export const PromptInputBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-body"
    className={cn('relative', className)}
    {...props}
  />
));
PromptInputBody.displayName = 'PromptInputBody';

/* ─── PromptInputTextarea ────────────────────────────────────────── */

export const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="prompt-input-textarea"
    className={cn(
      // Metrics here are mirrored by the composer's mention-highlight overlay —
      // keep px/py/font-size/line-height in sync with it or mentions drift.
      'chat-input-placeholder block max-h-[40vh] w-full resize-none overflow-y-auto bg-transparent px-4 py-3 text-[13px] leading-[1.55] text-foreground placeholder-faint focus:outline-none sm:max-h-[300px]',
      className
    )}
    {...props}
  />
));
PromptInputTextarea.displayName = 'PromptInputTextarea';

/* ─── PromptInputFooter ──────────────────────────────────────────── */

export const PromptInputFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-footer"
    className={cn('flex items-center justify-between gap-2 border-t border-border px-2 py-2', className)}
    {...props}
  />
));
PromptInputFooter.displayName = 'PromptInputFooter';

/* ─── PromptInputTools ───────────────────────────────────────────── */

export const PromptInputTools = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="prompt-input-tools"
    // The chip row is the flexible half of the footer. Chips keep their size
    // and the row scrolls when the composer is too narrow for all of them —
    // without this the row overflows and rides over the send controls, and
    // clipping instead of scrolling would put the mode and model pickers out
    // of reach.
    className={cn('flex min-w-0 flex-1 items-center gap-1 overflow-x-auto', className)}
    {...props}
  />
));
PromptInputTools.displayName = 'PromptInputTools';

/* ─── PromptInputButton ──────────────────────────────────────────── */

export interface PromptInputButtonTooltip {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export interface PromptInputButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip?: PromptInputButtonTooltip;
}

export const PromptInputButton = React.forwardRef<HTMLButtonElement, PromptInputButtonProps>(
  ({ className, tooltip, children, ...props }, ref) => {
    const button = (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="icon"
        className={cn('h-8 w-8 shrink-0 rounded-ctl [&_svg]:size-4', className)}
        {...props}
      >
        {children}
      </Button>
    );

    if (tooltip) {
      return (
        <Tooltip
          content={
            tooltip.shortcut ? (
              <span className="flex items-center gap-1.5">
                {tooltip.content}
                <kbd className="rounded-ctl bg-[var(--hover)] px-1 font-mono text-[10px] tracking-wide">
                  {tooltip.shortcut}
                </kbd>
              </span>
            ) : (
              tooltip.content
            )
          }
          position={tooltip.side ?? 'top'}
        >
          {button}
        </Tooltip>
      );
    }

    return button;
  }
);
PromptInputButton.displayName = 'PromptInputButton';

/* ─── PromptInputSubmit ──────────────────────────────────────────── */

export interface PromptInputSubmitProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  status?: PromptInputStatus;
}

export const PromptInputSubmit = React.forwardRef<HTMLButtonElement, PromptInputSubmitProps>(
  ({ className, status: statusProp, children, ...props }, ref) => {
    const context = React.useContext(PromptInputContext);
    const status = statusProp ?? context?.status ?? 'ready';
    const isActive = status === 'submitted' || status === 'streaming';

    return (
      <Button
        ref={ref}
        type={isActive ? 'button' : 'submit'}
        variant="default"
        size="icon"
        // The one solid action in the toolbar — everything else is ghost or outline.
        className={cn('h-8 w-8 shrink-0 rounded-ctl', className)}
        {...props}
      >
        {children ?? (isActive ? (
          <SquareIcon className="h-3.5 w-3.5 fill-current" />
        ) : (
          <SendHorizonalIcon className="h-4 w-4" />
        ))}
      </Button>
    );
  }
);
PromptInputSubmit.displayName = 'PromptInputSubmit';

export { usePromptInput };
