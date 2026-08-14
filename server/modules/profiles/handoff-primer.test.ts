import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHandoffPrimer,
  PRIMER_CHAR_BUDGET,
  renderConversationPrimer,
  type PrimerMessage,
} from '@/modules/profiles/handoff-primer.js';
import { configureHandoffSummaryRuntime } from '@/modules/profiles/handoff-primer-summarize.js';

/**
 * Separator between the compressed opening and the verbatim turns. Pinned here
 * on purpose: it is part of the document the destination model reads.
 */
const SUMMARY_END_MARKER = '_[end of the summary; the turns below are verbatim]_';

function textMessage(role: 'user' | 'assistant', content: string): PrimerMessage {
  return { kind: 'text', role, content };
}

function timedMessage(role: 'user' | 'assistant', content: string, timestamp: string): PrimerMessage {
  return { kind: 'text', role, content, timestamp };
}

/** Header length measured from a primer whose body is a known single block. */
async function headerLength(): Promise<number> {
  const block = '## user\n\nx';
  const primer = (await buildHandoffPrimer({
    messages: [textMessage('user', 'x')],
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
    destinationProvider: 'codex',
  })) as string;
  return primer.length - block.length - 2;
}

test('short history renders in full, without a truncation marker', async () => {
  const primer = await buildHandoffPrimer({
    messages: [
      textMessage('user', 'refactor the parser'),
      textMessage('assistant', 'done, split into two files'),
    ],
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
    destinationProvider: 'codex',
  });

  assert.ok(primer);
  assert.match(primer, /provider `claude` \(account "Personal"\)/);
  assert.match(primer, /reference context/);
  assert.match(primer, /## user\n\nrefactor the parser/);
  assert.match(primer, /## assistant\n\ndone, split into two files/);
  assert.doesNotMatch(primer, /truncated/);
});

test('long history keeps the tail and names how many messages were omitted', async () => {
  // Each block is ~1k characters, so only a slice of these fits the budget.
  const messages = Array.from({ length: 80 }, (_, index) =>
    textMessage(index % 2 === 0 ? 'user' : 'assistant', `turn ${index} ${'x'.repeat(1000)}`),
  );

  const primer = await buildHandoffPrimer({
    messages,
    sourceProvider: 'codex',
    destinationProvider: 'claude',
  });
  assert.ok(primer);

  const marker = primer.match(/_\[truncated: (\d+) earlier messages omitted\]_/);
  assert.ok(marker, 'expected an explicit truncation marker');

  const omitted = Number(marker[1]);
  assert.ok(omitted > 0 && omitted < 80);

  // The most recent turn survives; the oldest ones are the ones dropped.
  assert.ok(primer.includes('turn 79 '));
  assert.ok(!primer.includes('turn 0 '));
  // The marker's count must match what is actually missing from the body.
  const rendered = (primer.match(/^## /gm) ?? []).length;
  assert.equal(omitted, 80 - rendered);
});

test('empty history returns null', async () => {
  assert.equal(
    await buildHandoffPrimer({
      messages: [],
      sourceProvider: 'claude',
      destinationProvider: 'codex',
    }),
    null,
  );
});

test('history without renderable text returns null', async () => {
  const primer = await buildHandoffPrimer({
    messages: [
      textMessage('user', '   '),
      { kind: 'text', role: 'assistant' },
      { kind: 'text', role: 'system', content: 'boot' },
    ],
    sourceProvider: 'claude',
    destinationProvider: 'codex',
  });

  assert.equal(primer, null);
});

test('tool calls, tool results and thinking blocks are dropped', async () => {
  const primer = await buildHandoffPrimer({
    messages: [
      { kind: 'tool_use', role: 'assistant', content: 'ReadFile(server/index.ts)' },
      { kind: 'tool_result', content: 'const app = express()' },
      { kind: 'thinking', role: 'assistant', content: 'maybe the router is stale' },
      textMessage('assistant', 'the router was stale'),
    ],
    sourceProvider: 'claude',
    destinationProvider: 'codex',
  });

  assert.ok(primer);
  assert.ok(!primer.includes('ReadFile'));
  assert.ok(!primer.includes('const app = express()'));
  assert.ok(!primer.includes('maybe the router is stale'));
  assert.match(primer, /## assistant\n\nthe router was stale/);
});

test('output never exceeds the budget beyond the header and marker', async () => {
  const messages = Array.from({ length: 200 }, (_, index) =>
    textMessage('user', `turn ${index} ${'y'.repeat(500)}`),
  );

  const primer = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
    destinationProvider: 'codex',
  });

  assert.ok(primer);
  const overhead = (await headerLength()) + 64; // header plus the truncation marker line
  assert.ok(
    primer.length <= PRIMER_CHAR_BUDGET + overhead,
    `primer of ${primer.length} chars overflows the ${PRIMER_CHAR_BUDGET} budget`,
  );
});

test('a single message larger than the budget keeps its most recent end', async () => {
  const tail = 'the actual conclusion';
  const primer = await buildHandoffPrimer({
    messages: [textMessage('user', `${'z'.repeat(PRIMER_CHAR_BUDGET * 2)} ${tail}`)],
    sourceProvider: 'claude',
    destinationProvider: 'codex',
  });

  assert.ok(primer);
  assert.ok(primer.endsWith(tail));
});

test('a custom header replaces the handoff one and keeps the rendered body', () => {
  const primer = renderConversationPrimer(
    [textMessage('user', 'why is the build slow'), textMessage('assistant', 'cold cache')],
    '# Context from the current conversation',
  );

  assert.ok(primer);
  assert.ok(primer.startsWith('# Context from the current conversation\n\n'));
  assert.doesNotMatch(primer, /earlier conversation/);
  assert.match(primer, /## user\n\nwhy is the build slow/);
  assert.match(primer, /## assistant\n\ncold cache/);
});

test('a custom header alone is not a primer: empty and tool-only histories return null', () => {
  const header = '# Context from the current conversation';

  assert.equal(renderConversationPrimer([], header), null);
  assert.equal(
    renderConversationPrimer(
      [
        { kind: 'tool_use', role: 'assistant', content: 'ReadFile(server/index.ts)' },
        { kind: 'tool_result', content: 'const app = express()' },
      ],
      header,
    ),
    null,
  );
});

test('a custom header still gets a truncation marker when the body overflows', () => {
  const messages = Array.from({ length: 80 }, (_, index) =>
    textMessage(index % 2 === 0 ? 'user' : 'assistant', `turn ${index} ${'x'.repeat(1000)}`),
  );

  const primer = renderConversationPrimer(messages, '# Context from the current conversation');

  assert.ok(primer);
  const marker = primer.match(/_\[truncated: (\d+) earlier messages omitted\]_/);
  assert.ok(marker, 'expected an explicit truncation marker');
  assert.ok(primer.includes('turn 79 '));
  assert.ok(!primer.includes('turn 0 '));
  const rendered = (primer.match(/^## /gm) ?? []).length;
  assert.equal(Number(marker[1]), 80 - rendered);
});

test('since absent renders identically to the plain call', async () => {
  const messages = [
    timedMessage('user', 'refactor the parser', '2026-08-14T10:00:00.000Z'),
    timedMessage('assistant', 'done, split into two files', '2026-08-14T10:05:00.000Z'),
  ];

  const withoutSince = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    destinationProvider: 'codex',
  });
  const withUndefinedSince = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    destinationProvider: 'codex',
    since: undefined,
  });

  assert.ok(withoutSince);
  assert.equal(withUndefinedSince, withoutSince);
});

test('since mid-conversation only keeps messages strictly after the cutoff', async () => {
  const messages = [
    timedMessage('user', 'first leg question', '2026-08-14T10:00:00.000Z'),
    timedMessage('assistant', 'first leg answer', '2026-08-14T10:05:00.000Z'),
    timedMessage('user', 'second leg question', '2026-08-14T11:00:00.000Z'),
    timedMessage('assistant', 'second leg answer', '2026-08-14T11:05:00.000Z'),
  ];

  const primer = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    destinationProvider: 'codex',
    since: '2026-08-14T10:05:00.000Z',
  });

  assert.ok(primer);
  assert.ok(!primer.includes('first leg question'));
  assert.ok(!primer.includes('first leg answer'));
  assert.match(primer, /## user\n\nsecond leg question/);
  assert.match(primer, /## assistant\n\nsecond leg answer/);
});

test('since after everything returns null', async () => {
  const messages = [
    timedMessage('user', 'only message', '2026-08-14T10:00:00.000Z'),
  ];

  const primer = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    destinationProvider: 'codex',
    since: '2026-08-14T12:00:00.000Z',
  });

  assert.equal(primer, null);
});

test('since still enforces the character budget on the filtered set', async () => {
  const before = Array.from({ length: 40 }, (_, index) =>
    timedMessage('user', `stale turn ${index} ${'x'.repeat(1000)}`, '2026-08-14T09:00:00.000Z'),
  );
  const after = Array.from({ length: 40 }, (_, index) =>
    timedMessage(
      index % 2 === 0 ? 'user' : 'assistant',
      `fresh turn ${index} ${'x'.repeat(1000)}`,
      '2026-08-14T11:00:00.000Z',
    ),
  );

  const primer = await buildHandoffPrimer({
    messages: [...before, ...after],
    sourceProvider: 'claude',
    destinationProvider: 'codex',
    since: '2026-08-14T10:00:00.000Z',
  });

  assert.ok(primer);
  assert.ok(!primer.includes('stale turn'));
  assert.ok(primer.includes('fresh turn 39 '));

  const marker = primer.match(/_\[truncated: (\d+) earlier messages omitted\]_/);
  assert.ok(marker, 'expected an explicit truncation marker within the filtered set');
  assert.ok(!primer.includes('fresh turn 0 '));
});

test('malformed entries are skipped instead of throwing', async () => {
  const messages = [
    null,
    undefined,
    'not a message',
    { kind: 'text', role: 'user', content: 42 },
    textMessage('user', 'still here'),
  ] as unknown as PrimerMessage[];

  const primer = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    destinationProvider: 'codex',
  });

  assert.ok(primer);
  assert.match(primer, /## user\n\nstill here/);
});

test('the header frames the switch as one conversation still in progress', async () => {
  const primer = await buildHandoffPrimer({
    messages: [textMessage('user', 'keep going')],
    sourceProvider: 'codex',
    sourceProfileName: 'Work',
    destinationProvider: 'claude',
  });

  assert.ok(primer);
  assert.match(primer, /# Continuing this conversation/);
  assert.match(primer, /You're continuing this same conversation/);
  assert.doesNotMatch(primer, /earlier conversation/i);
  assert.doesNotMatch(primer, /another session/i);
  // Nothing was compressed, so the header must not claim anything was.
  assert.doesNotMatch(primer, /summar/i);
  assert.match(primer, /reference context/);
});

test('renderConversationPrimer keeps its own header and fixed budget', () => {
  const primer = renderConversationPrimer(
    [textMessage('user', 'why is the build slow'), textMessage('assistant', 'cold cache')],
    '# Context from the current conversation',
  );

  assert.equal(
    primer,
    '# Context from the current conversation\n\n## user\n\nwhy is the build slow\n\n## assistant\n\ncold cache',
  );

  // The fixed budget is the module constant, whatever a destination model would
  // have allowed: one block over it truncates.
  const overflowing = renderConversationPrimer(
    [
      textMessage('user', 'x'.repeat(PRIMER_CHAR_BUDGET)),
      textMessage('assistant', 'the conclusion'),
    ],
    '# Context from the current conversation',
  );

  assert.ok(overflowing);
  assert.match(overflowing, /_\[truncated: 1 earlier message omitted\]_/);
  assert.ok(overflowing.endsWith('## assistant\n\nthe conclusion'));
});

/**
 * Everything below runs against an installed summary runtime. The seam is
 * module-level state with no unset, so these have to stay after the tests above
 * — those cover the unwired case, which is also the default installation.
 */

/** Installs a fake summary runtime and records what it was asked. */
function installSummaryQuery(answer: string | (() => never)): string[] {
  const prompts: string[] = [];
  configureHandoffSummaryRuntime(async (prompt) => {
    prompts.push(prompt);
    return typeof answer === 'function' ? answer() : answer;
  });
  return prompts;
}

/** ~1k characters per turn, each tagged so a primer can be searched for it. */
function longConversation(count: number): PrimerMessage[] {
  return Array.from({ length: count }, (_unused, index) =>
    textMessage(index % 2 === 0 ? 'user' : 'assistant', `turn ${index} ${'x'.repeat(1000)}`),
  );
}

test('a destination with a wide window carries the whole conversation, unsummarized', async () => {
  const prompts = installSummaryQuery('compressed background');
  const messages = longConversation(80);

  const primer = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
    destinationProvider: 'codex',
    destinationModel: 'gpt-4.1',
  });

  assert.ok(primer);
  assert.ok(primer.includes('turn 0 '), 'the opening turn crosses over');
  assert.ok(primer.includes('turn 79 '), 'so does the most recent one');
  assert.doesNotMatch(primer, /truncated/);
  assert.ok(!primer.includes(SUMMARY_END_MARKER));
  assert.equal(prompts.length, 0, 'nothing overflowed, so no summary run was started');
});

test('an overflowing conversation crosses as a summary plus the verbatim tail', async () => {
  const prompts = installSummaryQuery('the opening turns, compressed');
  const messages = longConversation(80);

  const primer = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
    destinationProvider: 'codex',
  });

  assert.ok(primer);
  assert.equal(prompts.length, 1);
  assert.ok(primer.includes('the opening turns, compressed'));
  assert.doesNotMatch(primer, /truncated/, 'nothing was cut blind');
  assert.match(primer, /condensed into the summary below/, 'the header flags the lossy part');

  const [, verbatim] = primer.split(`${SUMMARY_END_MARKER}\n\n`);
  assert.ok(verbatim, 'the summary and the raw turns are separated');

  const firstKept = Number(/^## (?:user|assistant)\n\nturn (\d+) /m.exec(verbatim)?.[1]);
  assert.ok(firstKept > 0 && firstKept < 80, 'part of the conversation was compressed');
  assert.ok(
    prompts[0].includes(`turn ${firstKept - 1} `),
    'the span handed to the summary run ends where the verbatim tail begins',
  );
  assert.ok(!prompts[0].includes(`turn ${firstKept} `), 'the kept tail is never summarized');
  assert.equal(
    verbatim,
    messages
      .slice(firstKept)
      .map((message) => `## ${message.role}\n\n${message.content}`)
      .join('\n\n'),
    'the tail is rendered byte for byte, with no gap up to the last turn',
  );
});

test('a summary that cannot be produced falls back to plain truncation', async () => {
  installSummaryQuery(() => {
    throw new Error('the runtime is unavailable');
  });
  const messages = longConversation(80);

  const primer = await buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
    destinationProvider: 'codex',
  });

  assert.ok(primer);
  assert.ok(!primer.includes(SUMMARY_END_MARKER));
  assert.match(primer, /_\[truncated: \d+ earlier messages omitted\]_/);
  assert.doesNotMatch(primer, /condensed into the summary below/);

  // Byte for byte what the fixed-budget renderer alone would have produced.
  const header = primer.slice(0, primer.indexOf('\n\n_[truncated'));
  assert.equal(primer, renderConversationPrimer(messages, header));
});
