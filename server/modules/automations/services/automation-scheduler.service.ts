/**
 * The clock behind cron and quota triggers.
 *
 * One interval for the whole installation, aligned to the top of each minute —
 * the same shape as the websocket heartbeat, and deliberately not a job library:
 * the engine only ever asks "which rules are due now", and a tick that lands a
 * second late still lands in the right minute.
 *
 * Ticks never overlap. A tick that is still dispatching when the next one comes
 * around is skipped rather than queued: firing the same minute's rules twice is
 * exactly what the dedupe key exists to prevent, and piling up ticks behind a
 * slow provider call would turn one stuck spawn into an unbounded backlog.
 */

const TICK_INTERVAL_MS = 60_000;

export interface AutomationScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export interface AutomationSchedulerDeps {
  /** Fires everything due at this moment; must never reject. */
  runTick(at: Date): Promise<unknown>;
  /** Overridable so tests drive the interval without waiting a minute. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  now?: () => Date;
}

export function createAutomationScheduler(deps: AutomationSchedulerDeps): AutomationScheduler {
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const now = deps.now ?? ((): Date => new Date());

  let interval: ReturnType<typeof setInterval> | null = null;
  let alignment: ReturnType<typeof setTimeout> | null = null;
  let ticking = false;

  function tick(): void {
    if (ticking) {
      console.warn('[automations] skipping a tick while the previous one is still running');
      return;
    }

    ticking = true;
    void Promise.resolve()
      .then(() => deps.runTick(now()))
      .catch((error: unknown) => {
        // Unreachable while runTick swallows per-rule failures; a tick that
        // throws anyway must not kill the interval for the rest of the process.
        console.error('[automations] a scheduler tick failed:', error);
      })
      .finally(() => {
        ticking = false;
      });
  }

  return {
    start(): void {
      if (interval || alignment) return;

      // Minute granularity means a tick that runs at :59.8 and the next at
      // :00.9 would skip a minute entirely; aligning once at startup keeps
      // every later tick near the top of its minute.
      const msToNextMinute = TICK_INTERVAL_MS - (now().getTime() % TICK_INTERVAL_MS);
      alignment = setTimeoutFn(() => {
        alignment = null;
        tick();
        interval = setIntervalFn(tick, TICK_INTERVAL_MS);
        // A timer nobody awaits must not be the reason the process refuses to exit.
        interval.unref?.();
      }, msToNextMinute);
      alignment.unref?.();
    },

    stop(): void {
      if (alignment) {
        clearTimeoutFn(alignment);
        alignment = null;
      }
      if (interval) {
        clearIntervalFn(interval);
        interval = null;
      }
    },

    isRunning: () => interval !== null || alignment !== null,
  };
}
