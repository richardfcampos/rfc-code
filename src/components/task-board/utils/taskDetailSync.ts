// Pure decision logic for how the task detail modal reacts to a `task_update`
// WS frame, split out of `useTaskDetail` so the branching is unit-testable
// without a live WebSocket. Every attachment/evidence mutation broadcasts the
// parent task (`broadcastTaskDetailUpdate` in tasks.routes.ts) rather than the
// changed row itself, so "updated" always means "refetch the full detail".

export type TaskDetailSyncAction = 'refresh' | 'close' | 'ignore';

/** Loosely-typed mirror of the WS `ServerEvent` shape — `subscribe` fans out every
 * frame kind with `task`/`action` left as `unknown`, so this narrows at runtime
 * instead of trusting a compile-time shape that the socket never actually enforces. */
type MinimalTaskUpdateEvent = {
  kind?: string;
  action?: unknown;
  task?: unknown;
};

/**
 * Decides what an open task detail view should do with an incoming WS event.
 * `openTaskId` is `undefined` when no detail view is open (always "ignore").
 */
export function decideTaskDetailSync(
  event: MinimalTaskUpdateEvent,
  openTaskId: string | undefined,
): TaskDetailSyncAction {
  if (!openTaskId || event.kind !== 'task_update') {
    return 'ignore';
  }
  const taskId = (event.task as { id?: unknown } | null | undefined)?.id;
  if (typeof taskId !== 'string' || taskId !== openTaskId) {
    return 'ignore';
  }
  return event.action === 'deleted' ? 'close' : 'refresh';
}
