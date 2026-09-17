import { Check, ChevronDown, GitBranch, GitFork, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CompareTarget } from '../../types/types';

type CompareTargetPickerProps = {
  isMobile: boolean;
  selected: CompareTarget | null;
  worktreeTargets: CompareTarget[];
  branchTargets: CompareTarget[];
  onSelect: (target: CompareTarget) => void;
};

function matchesQuery(target: CompareTarget, query: string): boolean {
  return (
    target.label.toLowerCase().includes(query) ||
    target.ref.toLowerCase().includes(query) ||
    (target.detail ?? '').toLowerCase().includes(query)
  );
}

/** Dropdown listing every worktree and branch the checkout can be compared with. */
export default function CompareTargetPicker({
  isMobile,
  selected,
  worktreeTargets,
  branchTargets,
  onSelect,
}: CompareTargetPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    } else {
      setQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const sections = useMemo(
    () =>
      [
        { title: 'Worktrees', Icon: GitFork, targets: worktreeTargets },
        { title: 'Branches', Icon: GitBranch, targets: branchTargets },
      ].map((section) => ({
        ...section,
        targets: normalizedQuery
          ? section.targets.filter((target) => matchesQuery(target, normalizedQuery))
          : section.targets,
      })),
    [branchTargets, normalizedQuery, worktreeTargets],
  );
  const hasMatches = sections.some((section) => section.targets.length > 0);

  const isSelected = (target: CompareTarget) =>
    selected?.kind === target.kind && selected.ref === target.ref;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen((previous) => !previous)}
        className={`flex max-w-full items-center rounded-lg border border-border bg-card transition-colors hover:bg-accent ${
          isMobile ? 'space-x-1 px-2 py-1 text-xs' : 'space-x-2 px-3 py-1.5 text-sm'
        }`}
        title="Choose what to compare with"
      >
        {selected?.kind === 'worktree' ? (
          <GitFork className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium">{selected?.label ?? 'Choose a branch or worktree'}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search branches and worktrees..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="shrink-0 text-muted-foreground hover:text-foreground" title="Clear search">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {!hasMatches && (
              <div className="px-4 py-3 text-center text-sm text-muted-foreground">Nothing to compare with</div>
            )}
            {sections.map(({ title, Icon, targets }) =>
              targets.length === 0 ? null : (
                <div key={title}>
                  <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    <Icon className="h-3 w-3" />
                    {title}
                  </div>
                  {targets.map((target) => (
                    <button
                      key={`${target.kind}:${target.ref}`}
                      onClick={() => {
                        onSelect(target);
                        setIsOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                        isSelected(target) ? 'bg-accent/50 text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {isSelected(target) ? <Check className="h-3 w-3 shrink-0 text-primary" /> : <span className="w-3 shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${isSelected(target) ? 'font-medium' : ''}`}>{target.label}</span>
                        {target.detail && (
                          <span className="block truncate font-mono text-[11px] text-muted-foreground/70">{target.detail}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
