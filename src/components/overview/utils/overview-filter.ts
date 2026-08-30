import type { OverviewSession, OverviewTask } from './overview-data';

/**
 * The four status filters of the overview header. An empty active set means
 * "All": every session, every non-done task, and no dimmed board columns.
 * With one or more filters active, each list shows the union of what the
 * active filters match.
 */
export type OverviewFilterId = 'run' | 'attn' | 'review' | 'done';

export const OVERVIEW_FILTER_IDS: readonly OverviewFilterId[] = ['run', 'attn', 'review', 'done'];

export const isOverviewFilterId = (value: string): value is OverviewFilterId =>
  (OVERVIEW_FILTER_IDS as readonly string[]).includes(value);

/** Parses a `?f=run,attn` query value, silently dropping unknown entries. */
export const parseOverviewFilterParam = (value: string | null): Set<OverviewFilterId> =>
  new Set((value ?? '').split(',').filter(isOverviewFilterId));

export const serializeOverviewFilterParam = (active: ReadonlySet<OverviewFilterId>): string =>
  OVERVIEW_FILTER_IDS.filter((id) => active.has(id)).join(',');

const sessionMatchers: Record<OverviewFilterId, (session: OverviewSession) => boolean> = {
  run: (session) => session.status === 'run',
  attn: (session) => session.status === 'attn',
  review: (session) => session.taskRef?.status === 'review',
  // "Done" reads as sessions that finished working — the idle ones.
  done: (session) => session.status === 'idle',
};

export function filterOverviewSessions(
  sessions: readonly OverviewSession[],
  active: ReadonlySet<OverviewFilterId>,
): OverviewSession[] {
  if (active.size === 0) {
    return [...sessions];
  }
  return sessions.filter((session) => [...active].some((id) => sessionMatchers[id](session)));
}

const TASK_STATUS_BY_FILTER: Record<OverviewFilterId, string> = {
  run: 'in-progress',
  // A session needing attention usually means its task landed in review.
  attn: 'review',
  review: 'review',
  done: 'done',
};

export function filterOverviewTasks(
  tasks: readonly OverviewTask[],
  active: ReadonlySet<OverviewFilterId>,
): OverviewTask[] {
  if (active.size === 0) {
    return tasks.filter((task) => !task.isDone);
  }
  return tasks.filter((task) =>
    [...active].some((id) =>
      id === 'done' ? task.isDone : task.status === TASK_STATUS_BY_FILTER[id],
    ),
  );
}

/**
 * Which board columns stay lit for the active filters, in the shape
 * `BoardsSection` expects for `dimmedColumns`: null dims nothing, otherwise
 * statuses outside the returned set render dimmed.
 */
export function litBoardColumns(active: ReadonlySet<OverviewFilterId>): Set<string> | null {
  if (active.size === 0) {
    return null;
  }
  return new Set([...active].map((id) => TASK_STATUS_BY_FILTER[id]));
}
