import type { ReactNode, Ref } from 'react';
import { Check } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { ComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';

/**
 * Shared shell for the composer popovers (model/effort and permissions) so both
 * menus share one surface, one heading style and one row style.
 */
export function ComposerMenuSurface({
  anchor,
  menuRef,
  ariaLabel,
  children,
}: {
  anchor: ComposerMenuAnchor;
  menuRef: Ref<HTMLDivElement>;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-[100] min-w-48 overflow-y-auto overscroll-contain rounded-card border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-pop)]"
      style={{
        right: anchor.right,
        bottom: anchor.bottom,
        maxHeight: anchor.maxHeight,
        maxWidth: anchor.maxWidth,
      }}
    >
      {children}
    </div>
  );
}

export function ComposerMenuHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{children}</p>
  );
}

export function ComposerMenuSeparator() {
  return <div className="my-1 h-px bg-border" aria-hidden />;
}

export function ComposerMenuItem({
  label,
  description,
  icon,
  isSelected,
  onSelect,
  role = 'menuitemradio',
  trailing,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  role?: 'menuitemradio' | 'menuitem';
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitemradio' ? isSelected : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-ctl px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 ease-out',
        'hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected ? 'text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {icon && <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-5">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-4 text-faint">{description}</span>
        )}
      </span>
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {trailing ?? (isSelected ? <Check className="h-3.5 w-3.5 text-primary" /> : null)}
      </span>
    </button>
  );
}
