import type { TaskMasterTask } from '../types';

const CLOSED_STATUSES = new Set(['done', 'cancelled']);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when a done/cancelled task was last touched more than `afterDays` ago.
 * `afterDays <= 0` disables the check. Tasks without a parseable `updatedAt`
 * are never considered stale — hiding something of unknown age is worse than
 * showing it.
 */
export function isStaleClosedTask(task: TaskMasterTask, afterDays: number, now = Date.now()): boolean {
  if (afterDays <= 0 || !CLOSED_STATUSES.has(task.status ?? '')) {
    return false;
  }
  const updatedAt = typeof task.updatedAt === 'string' ? Date.parse(task.updatedAt) : Number.NaN;
  if (Number.isNaN(updatedAt)) {
    return false;
  }
  return now - updatedAt > afterDays * DAY_MS;
}
