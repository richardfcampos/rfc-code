import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureHandoffSummaryRuntime,
  summarizeOverflow,
} from '@/modules/profiles/handoff-primer-summarize.js';
import type { PrimerMessage } from '@/modules/profiles/handoff-primer.js';

interface QueryCall {
  prompt: string;
  options: { cwd?: string; model?: string; profileId?: string };
}

/**
 * Installs a fake runtime and records what it was asked. The seam is
 * module-level state with no unset, so tests that need the unwired case have
 * to run before the first install — see the first test in this file.
 */
function installQuery(answer: string | (() => never)): QueryCall[] {
  const calls: QueryCall[] = [];
  configureHandoffSummaryRuntime(async (prompt, options) => {
    calls.push({ prompt, options });
    return typeof answer === 'function' ? answer() : answer;
  });
  return calls;
}

/** Messages of a known size, each tagged so a prompt can be searched for it. */
function conversation(count: number, sizeChars = 980): PrimerMessage[] {
  return Array.from({ length: count }, (_unused, index) => ({
    kind: 'text',
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `marker-${index} ${'x'.repeat(sizeChars)}`,
  }));
}

// Must stay first: it is the only point at which no runtime has been wired yet.
test('with no runtime wired the summary is skipped rather than attempted', async () => {
  const result = await summarizeOverflow(conversation(10), 4_000);

  assert.equal(result, null);
});

test('the recent turns stay verbatim and only the older span is compressed', async () => {
  const calls = installQuery('compressed background');
  const messages = conversation(10);

  const result = await summarizeOverflow(messages, 4_000, { profileId: 'profile-a' });

  assert.ok(result);
  assert.equal(result.summary, 'compressed background');
  // 75% of 4000 chars fits the last two ~1011-character blocks and no more.
  assert.equal(result.keptFromIndex, 8);
  assert.deepEqual(messages.slice(result.keptFromIndex), [messages[8], messages[9]]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.profileId, 'profile-a');
});

test('the compressed span carries the old turns and none of the kept tail', async () => {
  const calls = installQuery('compressed background');

  const result = await summarizeOverflow(conversation(10), 4_000);

  assert.ok(result);
  const { prompt } = calls[0];
  assert.ok(prompt.includes('marker-0'), 'the oldest turn reaches the summary run');
  assert.ok(prompt.includes('marker-7'), 'the span runs up to the tail');
  assert.ok(!prompt.includes('marker-8'), 'the kept tail is not summarized');
  assert.ok(!prompt.includes('marker-9'), 'the kept tail is not summarized');
  assert.match(prompt, /not instructions/, 'the span is framed as material to compress');
});

test('a run that fails leaves the handoff to truncate instead of throwing', async () => {
  installQuery(() => {
    throw new Error('the runtime is unavailable');
  });

  const result = await summarizeOverflow(conversation(10), 4_000);

  assert.equal(result, null);
});

test('an answer with no content is treated as no summary', async () => {
  installQuery('   \n  ');

  const result = await summarizeOverflow(conversation(10), 4_000);

  assert.equal(result, null);
});

test('a conversation that fits the tail budget has nothing to compress', async () => {
  const calls = installQuery('compressed background');

  const result = await summarizeOverflow(conversation(2), 40_000);

  assert.equal(result, null);
  assert.equal(calls.length, 0, 'no run is started when nothing would be dropped');
});

test('an empty history and an unusable budget both skip the run', async () => {
  const calls = installQuery('compressed background');

  assert.equal(await summarizeOverflow([], 4_000), null);
  assert.equal(await summarizeOverflow(conversation(10), 0), null);
  assert.equal(await summarizeOverflow(conversation(10), Number.NaN), null);
  assert.equal(calls.length, 0);
});

test('tool traffic in the tail takes no budget from the turns that render', async () => {
  const calls = installQuery('compressed background');
  const messages = conversation(10);
  messages.splice(9, 0, { kind: 'tool_use', role: 'assistant', content: 'x'.repeat(4_000) });

  const result = await summarizeOverflow(messages, 4_000);

  assert.ok(result);
  assert.equal(result.keptFromIndex, 8, 'the unrendered block does not push the tail out');
  assert.ok(!calls[0].prompt.includes('marker-8'));
});
