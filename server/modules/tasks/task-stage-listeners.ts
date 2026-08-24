/**
 * The board's outbound seam for "a task just changed column".
 *
 * A stage transition is the one task event other features react to, and it can
 * originate from three places (the REST API, the MCP bridge, a future drag
 * handler) that must not each remember to notify anybody. The service emits it
 * once, here, and interested modules subscribe at boot — the same
 * configure-at-startup shape `configureCollabClaudeRuntime` uses, which keeps
 * the dependency pointing one way: nothing in this module imports the
 * subscribers.
 */

import type { TaskRow, TaskStage } from '@/modules/database/index.js';

export interface TaskStageChangedEvent {
  task: TaskRow;
  /** The stage the task left. Null when the previous value is unknown. */
  previousStage: TaskStage | null;
}

export type TaskStageListener = (event: TaskStageChangedEvent) => void | Promise<void>;

const listeners = new Set<TaskStageListener>();

/** Subscribes to stage transitions; returns the unsubscribe function. */
export function registerTaskStageListener(listener: TaskStageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announces a transition to every subscriber.
 *
 * Fire-and-forget by design: a task update must not fail, or block, because
 * something that reacts to it failed. Listener errors are logged and dropped —
 * both the synchronous kind and the rejected-promise kind.
 */
export function emitTaskStageChanged(event: TaskStageChangedEvent): void {
  for (const listener of listeners) {
    try {
      void Promise.resolve(listener(event)).catch((error: unknown) => {
        console.error('[tasks] a stage-change listener failed:', error);
      });
    } catch (error) {
      console.error('[tasks] a stage-change listener threw:', error);
    }
  }
}
