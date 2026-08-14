import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHandoffPrimer,
  PRIMER_CHAR_BUDGET,
  renderConversationPrimer,
  type PrimerMessage,
} from '@/modules/profiles/handoff-primer.js';

function textMessage(role: 'user' | 'assistant', content: string): PrimerMessage {
  return { kind: 'text', role, content };
}

/** Header length measured from a primer whose body is a known single block. */
function headerLength(): number {
  const block = '## user\n\nx';
  const primer = buildHandoffPrimer({
    messages: [textMessage('user', 'x')],
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
  }) as string;
  return primer.length - block.length - 2;
}

test('short history renders in full, without a truncation marker', () => {
  const primer = buildHandoffPrimer({
    messages: [
      textMessage('user', 'refactor the parser'),
      textMessage('assistant', 'done, split into two files'),
    ],
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
  });

  assert.ok(primer);
  assert.match(primer, /provider `claude` \(account "Personal"\)/);
  assert.match(primer, /reference context/);
  assert.match(primer, /## user\n\nrefactor the parser/);
  assert.match(primer, /## assistant\n\ndone, split into two files/);
  assert.doesNotMatch(primer, /truncated/);
});

test('long history keeps the tail and names how many messages were omitted', () => {
  // Each block is ~1k characters, so only a slice of these fits the budget.
  const messages = Array.from({ length: 80 }, (_, index) =>
    textMessage(index % 2 === 0 ? 'user' : 'assistant', `turn ${index} ${'x'.repeat(1000)}`),
  );

  const primer = buildHandoffPrimer({ messages, sourceProvider: 'codex' });
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

test('empty history returns null', () => {
  assert.equal(buildHandoffPrimer({ messages: [], sourceProvider: 'claude' }), null);
});

test('history without renderable text returns null', () => {
  const primer = buildHandoffPrimer({
    messages: [
      textMessage('user', '   '),
      { kind: 'text', role: 'assistant' },
      { kind: 'text', role: 'system', content: 'boot' },
    ],
    sourceProvider: 'claude',
  });

  assert.equal(primer, null);
});

test('tool calls, tool results and thinking blocks are dropped', () => {
  const primer = buildHandoffPrimer({
    messages: [
      { kind: 'tool_use', role: 'assistant', content: 'ReadFile(server/index.ts)' },
      { kind: 'tool_result', content: 'const app = express()' },
      { kind: 'thinking', role: 'assistant', content: 'maybe the router is stale' },
      textMessage('assistant', 'the router was stale'),
    ],
    sourceProvider: 'claude',
  });

  assert.ok(primer);
  assert.ok(!primer.includes('ReadFile'));
  assert.ok(!primer.includes('const app = express()'));
  assert.ok(!primer.includes('maybe the router is stale'));
  assert.match(primer, /## assistant\n\nthe router was stale/);
});

test('output never exceeds the budget beyond the header and marker', () => {
  const messages = Array.from({ length: 200 }, (_, index) =>
    textMessage('user', `turn ${index} ${'y'.repeat(500)}`),
  );

  const primer = buildHandoffPrimer({
    messages,
    sourceProvider: 'claude',
    sourceProfileName: 'Personal',
  });

  assert.ok(primer);
  const overhead = headerLength() + 64; // header plus the truncation marker line
  assert.ok(
    primer.length <= PRIMER_CHAR_BUDGET + overhead,
    `primer of ${primer.length} chars overflows the ${PRIMER_CHAR_BUDGET} budget`,
  );
});

test('a single message larger than the budget keeps its most recent end', () => {
  const tail = 'the actual conclusion';
  const primer = buildHandoffPrimer({
    messages: [textMessage('user', `${'z'.repeat(PRIMER_CHAR_BUDGET * 2)} ${tail}`)],
    sourceProvider: 'claude',
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

test('malformed entries are skipped instead of throwing', () => {
  const messages = [
    null,
    undefined,
    'not a message',
    { kind: 'text', role: 'user', content: 42 },
    textMessage('user', 'still here'),
  ] as unknown as PrimerMessage[];

  const primer = buildHandoffPrimer({ messages, sourceProvider: 'claude' });

  assert.ok(primer);
  assert.match(primer, /## user\n\nstill here/);
});
