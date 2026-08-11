import type { ReactNode } from 'react';

import { cn } from '../../../lib/utils';

/* ── Container ─────────────────────────────────────────────────── */
type PillBarProps = {
  children: ReactNode;
  className?: string;
};

export function PillBar({ children, className }: PillBarProps) {
  return (
    <div className={cn('inline-flex items-center gap-[2px] rounded-card border border-border bg-muted p-[3px]', className)}>
      {children}
    </div>
  );
}

/* ── Individual pill button ────────────────────────────────────── */
type PillProps = {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
};

export function Pill({ isActive, onClick, children, className }: PillProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex touch-manipulation items-center gap-1.5 rounded-ctl px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground active:bg-[var(--hover)]',
        className,
      )}
    >
      {children}
    </button>
  );
}
