import test from 'node:test';
import assert from 'node:assert/strict';

import type { ChatMessage } from '../../types/types';
import { calculateDiff } from '../../utils/messageTransforms';

import { getToolCallSummary, parseToolInput } from './tool-call-summary';
import { getToolDiffStats } from './tool-diff-stats';
import { formatToolDuration, getToolCallDurationMs, getToolRunElapsedMs } from './tool-duration';

function toolMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    type: 'assistant',
    content: '',
    timestamp: '2026-08-12T14:29:00.000Z',
    isToolUse: true,
    ...overrides,
  };
}

test('duration comes from the result timestamp minus the tool_use timestamp', () => {
  const message = toolMessage({
    toolName: 'Bash',
    timestamp: '2026-08-12T14:29:00.000Z',
    toolResult: { content: 'ok', timestamp: '2026-08-12T14:29:04.400Z' },
  });

  assert.equal(getToolCallDurationMs(message), 4400);
});

test('a missing result timestamp yields no duration instead of a guess', () => {
  const message = toolMessage({
    toolName: 'Read',
    toolResult: { content: 'file body' },
  });

  assert.equal(getToolCallDurationMs(message), null);
});

test('a tool that measured its own wall time is still trusted', () => {
  const message = toolMessage({
    toolName: 'Glob',
    toolResult: { content: '', toolUseResult: { durationMs: 183 } },
  });

  assert.equal(getToolCallDurationMs(message), 183);
});

test('a call still in flight has no duration', () => {
  assert.equal(getToolCallDurationMs(toolMessage({ toolName: 'Bash' })), null);
});

test('durations format as seconds and minutes', () => {
  assert.equal(formatToolDuration(300), '0.3s');
  assert.equal(formatToolDuration(4400), '4.4s');
  assert.equal(formatToolDuration(72_000), '1m 12s');
});

test('the card total is elapsed wall time, not a sum of overlapping calls', () => {
  // Four parallel reads issued in one assistant message: same start, 0.3s each.
  const parallelRun = [0, 0, 0, 0].map(() =>
    toolMessage({
      toolName: 'Read',
      timestamp: '2026-08-12T14:29:00.000Z',
      toolResult: { content: 'ok', timestamp: '2026-08-12T14:29:00.300Z' },
    }),
  );
  assert.equal(getToolRunElapsedMs(parallelRun), 300);

  // Sequential calls span from the first start to the last result.
  assert.equal(
    getToolRunElapsedMs([
      toolMessage({
        toolName: 'Bash',
        timestamp: '2026-08-12T14:29:00.000Z',
        toolResult: { content: 'ok', timestamp: '2026-08-12T14:29:01.000Z' },
      }),
      toolMessage({
        toolName: 'Bash',
        timestamp: '2026-08-12T14:29:01.000Z',
        toolResult: { content: 'ok', timestamp: '2026-08-12T14:29:02.500Z' },
      }),
    ]),
    2500,
  );

  // One call still in flight means the card shows no total at all.
  assert.equal(
    getToolRunElapsedMs([
      toolMessage({
        toolName: 'Bash',
        timestamp: '2026-08-12T14:29:00.000Z',
        toolResult: { content: 'ok', timestamp: '2026-08-12T14:29:01.000Z' },
      }),
      toolMessage({ toolName: 'Bash', timestamp: '2026-08-12T14:29:01.000Z' }),
    ]),
    null,
  );

  assert.equal(getToolRunElapsedMs([]), null);
});

test('diff stats prefer the structured patch shipped with the result', () => {
  const message = toolMessage({
    toolName: 'Edit',
    toolInput: JSON.stringify({ file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }),
    toolResult: {
      content: 'ok',
      toolUseResult: {
        structuredPatch: [{ lines: [' keep', '+one', '+two', '-gone'] }],
      },
    },
  });

  assert.deepEqual(getToolDiffStats(message, parseToolInput(message.toolInput), calculateDiff), {
    added: 2,
    removed: 1,
  });
});

test('diff stats fall back to the shared diff calculator', () => {
  const message = toolMessage({
    toolName: 'Edit',
    toolInput: JSON.stringify({ file_path: '/repo/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' }),
    toolResult: { content: 'ok' },
  });

  assert.deepEqual(getToolDiffStats(message, parseToolInput(message.toolInput), calculateDiff), {
    added: 2,
    removed: 1,
  });
});

test('non-mutating tools never show diff stats', () => {
  const message = toolMessage({ toolName: 'Read', toolInput: JSON.stringify({ file_path: '/repo/a.ts' }) });
  assert.equal(getToolDiffStats(message, parseToolInput(message.toolInput), calculateDiff), null);
});

test('file tools show the path relative to the project', () => {
  const message = toolMessage({ toolName: 'Read', toolInput: JSON.stringify({ file_path: '/repo/src/a.ts' }) });
  const summary = getToolCallSummary(message, parseToolInput(message.toolInput), '/repo');

  assert.equal(summary.label, 'Read');
  assert.equal(summary.primary, 'src/a.ts');
});

test('search tools report the tallies their result carries', () => {
  const message = toolMessage({
    toolName: 'Grep',
    toolInput: JSON.stringify({ pattern: 'usageSnapshot' }),
    toolResult: { content: '', toolUseResult: { numMatches: 11, numFiles: 6 } },
  });
  const summary = getToolCallSummary(message, parseToolInput(message.toolInput), '/repo');

  assert.equal(summary.primary, 'usageSnapshot');
  assert.equal(summary.detail, '11 matches in 6 files');
});

test('a search with no tallies shows no invented summary', () => {
  const message = toolMessage({ toolName: 'Grep', toolInput: JSON.stringify({ pattern: 'x' }) });
  assert.equal(getToolCallSummary(message, parseToolInput(message.toolInput), '/repo').detail, undefined);
});

test('bash rows read as the command itself', () => {
  const message = toolMessage({
    toolName: 'Bash',
    toolInput: JSON.stringify({ command: 'npm test -- profile-usage-broadcast' }),
  });

  assert.equal(
    getToolCallSummary(message, parseToolInput(message.toolInput), '/repo').primary,
    'npm test -- profile-usage-broadcast',
  );
});
