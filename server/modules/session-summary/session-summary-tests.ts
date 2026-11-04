/**
 * Heuristic detection of a test run inside a turn's tool output.
 *
 * The agent runs tests through a shell tool, so the only trace is the
 * runner's own summary line in a `tool_result`. Each runner has a stable
 * summary format; the last one seen in the turn wins, because a fix-then-rerun
 * turn ends with the run that matters.
 */

import type { NormalizedMessage } from '@/shared/types.js';

import type { SessionSummaryTests } from './session-summary.types.js';

type Matcher = (text: string) => SessionSummaryTests | null;

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function lastMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  let found: RegExpExecArray | null = null;
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (let match = global.exec(text); match; match = global.exec(text)) {
    found = match;
  }
  return found;
}

/** node:test TAP summary: `# pass 12` / `# fail 0`. */
const nodeTest: Matcher = (text) => {
  const pass = lastMatch(text, /^# pass (\d+)/m);
  if (!pass) return null;
  const fail = lastMatch(text, /^# fail (\d+)/m);
  const passed = toInt(pass[1]);
  const failed = toInt(fail?.[1]) ?? 0;
  return { runner: 'node:test', passed, failed, total: passed === null ? null : passed + failed };
};

/** vitest / jest: `Tests:  3 failed, 40 passed, 43 total` (parts in any order, some absent). */
const vitestJest: Matcher = (text) => {
  const line = lastMatch(text, /^[ \t]*Tests:[ \t]+([^\n]+)$/m);
  if (!line) return null;
  const summary = line[1] ?? '';
  const read = (label: string): number | null => toInt(new RegExp(`(\\d+) ${label}`).exec(summary)?.[1]);
  const passed = read('passed');
  const failed = read('failed') ?? 0;
  const total = read('total') ?? (passed === null ? null : passed + failed);
  const runner: SessionSummaryTests['runner'] = /vitest|✓|RUN\s+v\d/i.test(text) ? 'vitest' : 'jest';
  return { runner, passed, failed, total };
};

/** pytest: `===== 12 passed, 1 failed, 2 skipped in 0.42s =====`. */
const pytest: Matcher = (text) => {
  const line = lastMatch(text, /^=+ ([^=\n]*?(?:passed|failed|error)[^=\n]*?) in [\d.]+s[^=\n]*=+$/m);
  if (!line) return null;
  const summary = line[1] ?? '';
  const passed = toInt(/(\d+) passed/.exec(summary)?.[1]) ?? 0;
  const failed = (toInt(/(\d+) failed/.exec(summary)?.[1]) ?? 0) + (toInt(/(\d+) errors?/.exec(summary)?.[1]) ?? 0);
  return { runner: 'pytest', passed, failed, total: passed + failed };
};

/** phpunit: `OK (12 tests, 30 assertions)` or `Tests: 12, Assertions: 30, Failures: 1.` */
const phpunit: Matcher = (text) => {
  const ok = lastMatch(text, /^OK \((\d+) tests?/m);
  const failing = lastMatch(text, /^Tests: (\d+), Assertions: \d+(?:, (?:Failures|Errors): \d+)+/m);
  if (!ok && !failing) return null;
  const okIndex = ok?.index ?? -1;
  const failingIndex = failing?.index ?? -1;
  if (ok && okIndex > failingIndex) {
    const total = toInt(ok[1]);
    return { runner: 'phpunit', passed: total, failed: 0, total };
  }
  const line = failing?.[0] ?? '';
  const total = toInt(failing?.[1]);
  const failed = (toInt(/Failures: (\d+)/.exec(line)?.[1]) ?? 0) + (toInt(/Errors: (\d+)/.exec(line)?.[1]) ?? 0);
  return { runner: 'phpunit', passed: total === null ? null : total - failed, failed, total };
};

const MATCHERS: Matcher[] = [nodeTest, vitestJest, pytest, phpunit];

function readText(event: NormalizedMessage): string {
  const parts: string[] = [];
  if (typeof event.content === 'string') parts.push(event.content);
  if (typeof event.text === 'string') parts.push(event.text);
  const nested = event.toolResult?.content;
  if (typeof nested === 'string') parts.push(nested);
  return parts.join('\n');
}

/**
 * Scans tool output (newest last) and returns the last recognised run. A
 * matcher that fires on the earlier output of the same event is still
 * overridden by a later event, so the final rerun of the turn wins.
 */
/** Only the tail of one tool output is scanned: summaries sit at the end, and the regexes stay cheap. */
const MAX_SCANNED_CHARS = 20_000;

export function detectTestRun(events: NormalizedMessage[]): SessionSummaryTests | null {
  let detected: SessionSummaryTests | null = null;
  for (const event of events) {
    // Tool output only: a user quoting a test summary in a prompt is not a run.
    if (event.kind !== 'tool_result') continue;
    const full = readText(event);
    if (!full) continue;
    const text = full.length > MAX_SCANNED_CHARS ? full.slice(-MAX_SCANNED_CHARS) : full;
    for (const matcher of MATCHERS) {
      const result = matcher(text);
      if (result) detected = result;
    }
  }
  return detected;
}
