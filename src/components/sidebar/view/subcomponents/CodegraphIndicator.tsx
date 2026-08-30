import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Waypoints } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import { api } from '../../../../utils/api';

type CodegraphIndicatorProps = {
  project: Project;
  className?: string;
};

const POLL_INTERVAL_MS = 3000;
// Indexing a large repository takes seconds to a few minutes; past this the
// chip stops polling and falls back to whatever the next projects fetch says.
const MAX_POLLS = 100;

/**
 * CodeGraph chip for a sidebar project row. Indexed projects get a static
 * badge; unindexed ones get a click-to-index button that polls the backend
 * until the index shows up (indexing runs async server-side).
 */
export default function CodegraphIndicator({ project, className = '' }: CodegraphIndicatorProps) {
  const [localState, setLocalState] = useState<'idle' | 'indexing' | 'indexed'>('idle');
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
  }, []);

  const hasIndex = localState === 'indexed' || Boolean(project.codegraph?.hasCodegraph);
  const isIndexing = localState === 'indexing' || Boolean(project.codegraph?.indexing);

  const pollUntilIndexed = useCallback((projectId: string, remaining: number) => {
    pollTimerRef.current = setTimeout(async () => {
      try {
        const response = await api.projectCodegraph(projectId);
        if (response.ok) {
          const data = (await response.json()) as { codegraph?: { hasCodegraph?: boolean; indexing?: boolean } };
          if (data.codegraph?.hasCodegraph && !data.codegraph?.indexing) {
            setLocalState('indexed');
            return;
          }
        }
      } catch {
        // Transient fetch errors: keep polling until the budget runs out.
      }

      if (remaining > 1) {
        pollUntilIndexed(projectId, remaining - 1);
      } else {
        setLocalState('idle');
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const startIndexing = useCallback(async (event: React.MouseEvent) => {
    // The chip lives inside the project row button; don't select the project.
    event.stopPropagation();
    setLocalState('indexing');
    try {
      const response = await api.projectCodegraphInit(project.projectId);
      if (!response.ok && response.status !== 409) {
        setLocalState('idle');
        return;
      }
      pollUntilIndexed(project.projectId, MAX_POLLS);
    } catch {
      setLocalState('idle');
    }
  }, [pollUntilIndexed, project.projectId]);

  if (isIndexing && !hasIndex) {
    return (
      <span
        className={cn('inline-flex items-center justify-center rounded-full bg-primary/10 p-0.5', className)}
        title="CodeGraph indexing…"
      >
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
      </span>
    );
  }

  if (hasIndex) {
    return (
      <span
        className={cn('inline-flex items-center justify-center rounded-full bg-success/10 p-0.5', className)}
        title="CodeGraph indexed — structural queries available"
      >
        <Waypoints className="h-3 w-3 text-success" />
      </span>
    );
  }

  return (
    // Rendered inside the project row's <button>, so this must not be a
    // nested <button> (invalid HTML); a span with a click handler keeps the
    // row clickable while offering index-on-click.
    <span
      role="button"
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-full bg-idle/20 p-0.5 transition-colors duration-150 ease-out hover:bg-primary/10',
        className,
      )}
      onClick={startIndexing}
      title="Index with CodeGraph"
      aria-label="Index with CodeGraph"
    >
      <Waypoints className="h-3 w-3 text-faint" />
    </span>
  );
}
