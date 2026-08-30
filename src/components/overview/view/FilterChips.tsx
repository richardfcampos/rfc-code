import { cn } from '../../../lib/utils';

export type FilterChipOption = {
  id: string;
  /** Rendered after the count: `{count} {label}`, e.g. "2 running". */
  label: string;
  count: number;
  /** Tailwind background class for the status dot, e.g. 'bg-primary'. */
  dotClassName: string;
};

type FilterChipsProps = {
  options: FilterChipOption[];
  /** Active option ids; empty means "All" is active. */
  active: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  allLabel?: string;
};

const chipClassName = (isActive: boolean): string =>
  cn(
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-border-strong bg-card text-foreground hover:border-faint',
  );

/**
 * Multi-select status chips: each option toggles independently and "All"
 * clears the selection. The caller owns the set semantics (empty = all).
 */
export default function FilterChips({ options, active, onToggle, onAll, allLabel = 'All' }: FilterChipsProps) {
  const allActive = active.size === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onAll} aria-pressed={allActive} className={chipClassName(allActive)}>
        {allLabel}
      </button>
      {options.map((option) => {
        const isActive = active.has(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onToggle(option.id)}
            aria-pressed={isActive}
            className={chipClassName(isActive)}
          >
            <span
              className={cn(
                'h-2 w-2 flex-shrink-0 rounded-full',
                option.dotClassName,
                isActive && 'ring-[3px] ring-primary/20',
              )}
              aria-hidden="true"
            />
            {option.count} {option.label}
          </button>
        );
      })}
    </div>
  );
}
