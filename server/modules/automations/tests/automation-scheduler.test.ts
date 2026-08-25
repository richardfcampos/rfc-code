import assert from 'node:assert/strict';
import test from 'node:test';

import { createAutomationScheduler } from '@/modules/automations/services/automation-scheduler.service.js';

interface FakeTimers {
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
  runTimeout(): void;
  runInterval(): void;
  timeoutDelay: number | undefined;
  intervalDelay: number | undefined;
  cleared: number;
}

/** Hand-driven timers: the scheduler's whole job is when it calls things. */
function createFakeTimers(): FakeTimers {
  let timeoutCallback: (() => void) | null = null;
  let intervalCallback: (() => void) | null = null;
  const state = { timeoutDelay: undefined, intervalDelay: undefined, cleared: 0 } as FakeTimers;

  state.setTimeoutFn = ((callback: () => void, delay?: number) => {
    timeoutCallback = callback;
    state.timeoutDelay = delay;
    return { unref: () => {} } as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;

  state.setIntervalFn = ((callback: () => void, delay?: number) => {
    intervalCallback = callback;
    state.intervalDelay = delay;
    return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;

  state.clearTimeoutFn = (() => {
    state.cleared += 1;
  }) as unknown as typeof clearTimeout;
  state.clearIntervalFn = (() => {
    state.cleared += 1;
  }) as unknown as typeof clearInterval;

  state.runTimeout = () => timeoutCallback?.();
  state.runInterval = () => intervalCallback?.();
  return state;
}

/** The tick body runs on a microtask, so assertions about it wait one turn. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('the first tick is aligned to the top of the next minute, then runs every minute', async () => {
  const timers = createFakeTimers();
  const ticks: Date[] = [];
  const scheduler = createAutomationScheduler({
    ...timers,
    now: () => new Date(2026, 7, 24, 10, 30, 20),
    runTick: async (at) => {
      ticks.push(at);
    },
  });

  scheduler.start();
  assert.equal(timers.timeoutDelay, 40_000);
  assert.equal(scheduler.isRunning(), true);
  assert.equal(ticks.length, 0);

  timers.runTimeout();
  await flush();
  assert.equal(timers.intervalDelay, 60_000);
  assert.equal(ticks.length, 1);

  timers.runInterval();
  await flush();
  assert.equal(ticks.length, 2);
});

test('starting twice does not create a second clock', () => {
  const timers = createFakeTimers();
  const scheduler = createAutomationScheduler({ ...timers, runTick: async () => {} });

  scheduler.start();
  scheduler.start();
  timers.runTimeout();

  assert.equal(scheduler.isRunning(), true);
  scheduler.stop();
  assert.equal(scheduler.isRunning(), false);
  assert.equal(timers.cleared, 1);
});

test('stopping before the first tick cancels the alignment', () => {
  const timers = createFakeTimers();
  let ticks = 0;
  const scheduler = createAutomationScheduler({ ...timers, runTick: async () => { ticks += 1; } });

  scheduler.start();
  scheduler.stop();

  assert.equal(scheduler.isRunning(), false);
  assert.equal(timers.cleared, 1);
  assert.equal(ticks, 0);
});

test('a tick that is still running is skipped rather than queued behind itself', async () => {
  const timers = createFakeTimers();
  let started = 0;
  let release: () => void = () => {};
  const inFlight = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scheduler = createAutomationScheduler({
    ...timers,
    runTick: async () => {
      started += 1;
      await inFlight;
    },
  });

  scheduler.start();
  timers.runTimeout();
  await flush();
  timers.runInterval();
  timers.runInterval();
  assert.equal(started, 1);

  release();
  await inFlight;
  await flush();

  // Once the slow tick finished, the next one runs normally again.
  timers.runInterval();
  await flush();
  assert.equal(started, 2);
});

test('a tick that rejects does not kill the clock', async () => {
  const timers = createFakeTimers();
  let ticks = 0;
  const scheduler = createAutomationScheduler({
    ...timers,
    runTick: async () => {
      ticks += 1;
      throw new Error('tick exploded');
    },
  });

  scheduler.start();
  timers.runTimeout();
  await new Promise((resolve) => setImmediate(resolve));
  timers.runInterval();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ticks, 2);
});
