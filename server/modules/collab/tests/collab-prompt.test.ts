import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTurnPrompt,
  buildVerdictPrompt,
  hasConverged,
  parseConsensus,
  type CollabPromptMode,
  type PromptTranscriptEntry,
  type TurnPromptInput,
} from '../collab-prompt.service.js';

const transcript: PromptTranscriptEntry[] = [
  { name: 'Account A', role: 'participant', round: 1, content: 'We should keep SQLite.' },
  { name: 'Account B', role: 'participant', round: 1, content: 'Postgres scales better.' },
];

function turnInput(overrides: Partial<TurnPromptInput> = {}): TurnPromptInput {
  return {
    mode: 'debate',
    topic: 'Should the storage layer move to Postgres?',
    round: 1,
    maxRounds: 3,
    self: { name: 'Account A', role: 'participant' },
    others: [{ name: 'Account B', role: 'participant' }],
    transcript,
    ...overrides,
  };
}

// Shared framing: every participant must know the repo is readable but frozen,
// and that a blunt answer beats a polite one.
test('every mode states the read-only repo rule and the disagreement rule', () => {
  for (const mode of ['debate', 'review', 'vote', 'council'] as CollabPromptMode[]) {
    const prompt = buildTurnPrompt(turnInput({ mode }));
    assert.match(prompt, /read-only at your current working directory/, mode);
    assert.match(prompt, /Be concise and concrete/, mode);
    assert.match(prompt, /Disagreement is more useful than politeness/, mode);
  }
});

test('debate shows the transcript and demands engagement with the latest position', () => {
  const prompt = buildTurnPrompt(turnInput({ mode: 'debate' }));

  assert.match(prompt, /most recent position specifically/);
  assert.match(prompt, /Do not restate your own earlier argument/);
  assert.match(prompt, /Postgres scales better\./);
  assert.match(prompt, /^CONSENSUS: NO — <what blocks agreement, in one sentence>$/m);
});

test('review distinguishes author from reviewer and keeps the consensus contract', () => {
  const author = buildTurnPrompt(
    turnInput({ mode: 'review', self: { name: 'Account A', role: 'author' } }),
  );
  const reviewer = buildTurnPrompt(
    turnInput({ mode: 'review', self: { name: 'Account B', role: 'reviewer' } }),
  );

  assert.match(author, /the author\./);
  assert.match(author, /which of their points you accepted and which you rejected/);
  assert.doesNotMatch(author, /what evidence or change would make you agree/);

  assert.match(reviewer, /the reviewer\./);
  assert.match(reviewer, /what is wrong, why it is wrong, and what evidence or change would make you agree/);

  for (const prompt of [author, reviewer]) {
    assert.match(prompt, /^CONSENSUS: YES/m);
  }
});

test('vote hides the transcript, says answers are unseen, and asks for no consensus line', () => {
  const prompt = buildTurnPrompt(turnInput({ mode: 'vote' }));

  assert.match(prompt, /You are NOT seeing the other participants' answers/);
  assert.doesNotMatch(prompt, /Postgres scales better\./);
  assert.doesNotMatch(prompt, /Transcript so far/);
  assert.ok(!prompt.includes('CONSENSUS'), 'vote turns carry no consensus contract');
});

test('final-round wording appears only when round equals maxRounds', () => {
  for (const mode of ['debate', 'review'] as CollabPromptMode[]) {
    const middle = buildTurnPrompt(turnInput({ mode, round: 2, maxRounds: 3 }));
    const last = buildTurnPrompt(turnInput({ mode, round: 3, maxRounds: 3 }));

    assert.doesNotMatch(middle, /final round/, mode);
    assert.match(last, /This is the final round \(3 of 3\)/, mode);
    assert.match(last, /best final position/, mode);
  }
});

// A vote is one independent answer, so round bookkeeping would only imply an
// exchange that never happens.
test('vote never mentions a final round, even at round 1 of 1', () => {
  const prompt = buildTurnPrompt(turnInput({ mode: 'vote', round: 1, maxRounds: 1 }));

  assert.doesNotMatch(prompt, /final round/);
  assert.doesNotMatch(prompt, /best final position/);
});

test('an empty transcript tells the opening participant there is nothing yet', () => {
  const prompt = buildTurnPrompt(turnInput({ transcript: [] }));
  assert.match(prompt, /you are opening the discussion/);
});

test('verdict prompt asks for agreements, fair disagreements and a recommendation', () => {
  const prompt = buildVerdictPrompt({ topic: 'Storage layer', mode: 'debate', transcript });

  assert.match(prompt, /Points of agreement/);
  assert.match(prompt, /Remaining disagreements/);
  assert.match(prompt, /Recommendation/);
  assert.match(prompt, /including the ones you argued against/);
  assert.match(prompt, /If no agreement was reached, say so plainly/);
  assert.match(prompt, /Postgres scales better\./);
});

test('verdict prompt warns the arbiter that vote answers were written blind', () => {
  const prompt = buildVerdictPrompt({ topic: 'Storage layer', mode: 'vote', transcript });
  assert.match(prompt, /without seeing each other/);
});

test('parseConsensus reads YES, NO with reason, bold wrapping and lowercase', () => {
  assert.equal(parseConsensus('Agreed on all counts.\nCONSENSUS: YES'), true);
  assert.equal(parseConsensus('CONSENSUS: NO — the migration cost is unaccounted for'), false);
  assert.equal(parseConsensus('**CONSENSUS: YES**'), true);
  assert.equal(parseConsensus('consensus: no — still unconvinced'), false);
  assert.equal(parseConsensus('CONSENSUS: YES   '), true);
});

test('parseConsensus returns null when the contract is missing or unparseable', () => {
  assert.equal(parseConsensus('I think we are aligned.'), null);
  assert.equal(parseConsensus('CONSENSUS: MAYBE'), null);
  assert.equal(parseConsensus(''), null);
});

test('parseConsensus keeps the last declaration when a turn quotes an earlier one', () => {
  const content = [
    'Last round you wrote:',
    '> CONSENSUS: YES',
    '',
    'I have changed my mind since then.',
    'CONSENSUS: NO — the API surface is still open',
  ].join('\n');

  assert.equal(parseConsensus(content), false);
  assert.equal(parseConsensus('CONSENSUS: NO — early doubt\n\nCONSENSUS: YES'), true);
});

test('debate converges only when every participant declared YES', () => {
  const mode: CollabPromptMode = 'debate';

  assert.equal(
    hasConverged({
      mode,
      roundTurns: [
        { role: 'participant', consensus: true },
        { role: 'participant', consensus: true },
      ],
    }),
    true,
  );
  assert.equal(
    hasConverged({
      mode,
      roundTurns: [
        { role: 'participant', consensus: true },
        { role: 'participant', consensus: false },
      ],
    }),
    false,
  );
  assert.equal(
    hasConverged({
      mode,
      roundTurns: [
        { role: 'participant', consensus: true },
        { role: 'participant', consensus: null },
      ],
    }),
    false,
  );
  assert.equal(hasConverged({ mode, roundTurns: [] }), false);
});

test('review converges on the reviewer alone, never on the author', () => {
  const mode: CollabPromptMode = 'review';

  assert.equal(
    hasConverged({
      mode,
      roundTurns: [
        { role: 'author', consensus: true },
        { role: 'reviewer', consensus: false },
      ],
    }),
    false,
  );
  assert.equal(
    hasConverged({
      mode,
      roundTurns: [
        { role: 'author', consensus: false },
        { role: 'reviewer', consensus: true },
      ],
    }),
    true,
  );
  assert.equal(hasConverged({ mode, roundTurns: [{ role: 'author', consensus: true }] }), false);
  assert.equal(
    hasConverged({ mode, roundTurns: [{ role: 'reviewer', consensus: null }] }),
    false,
  );
});

test('vote never converges by signal', () => {
  assert.equal(
    hasConverged({ mode: 'vote', roundTurns: [{ role: 'participant', consensus: true }] }),
    false,
  );
});

test('council demands the five-part contract instead of the consensus line', () => {
  const prompt = buildTurnPrompt(turnInput({ mode: 'council' }));

  assert.match(prompt, /a member of a council examining the topic below/);
  // The five keys are the contract; a prompt that stops naming one of them
  // would quietly stop collecting it.
  for (const key of ['evidence', 'risks', 'tests', 'disagreements', 'confidence']) {
    assert.match(prompt, new RegExp(`"${key}"`), key);
  }
  assert.match(prompt, /fenced ```json block/);
  assert.match(prompt, /An empty "disagreements" array means you accept everything said so far/);

  // The one-line protocol would be a second, conflicting way to agree.
  assert.doesNotMatch(prompt, /^CONSENSUS: /m);
  // It is still a discussion: the transcript and the closing round still show.
  assert.match(prompt, /Postgres scales better\./);
});

test('a council turn is told what it may spend, and the older modes are not', () => {
  const budget = { totalTokens: 200_000, maxTurns: 7, tokenAllowance: 28_571 };

  const council = buildTurnPrompt(turnInput({ mode: 'council', budget }));
  assert.match(council, /may spend about 200,000 tokens across at most 7 turns/);
  assert.match(council, /roughly 28,571 tokens for yours/);
  assert.match(council, /The run stops when the budget is spent/);

  // Enforcement does not depend on the sentence: a council with no budget block
  // still runs, it just is not told the number.
  assert.doesNotMatch(buildTurnPrompt(turnInput({ mode: 'council' })), /may spend about/);
  assert.doesNotMatch(buildTurnPrompt(turnInput({ mode: 'debate', budget })), /may spend about/);
});

test('the arbiter of a council is told the answers carry contracts', () => {
  const prompt = buildVerdictPrompt({ topic: 'Split the scheduler?', mode: 'council', transcript });

  assert.match(prompt, /Each answer ends with a JSON contract/);
  assert.match(prompt, /not by how firmly it was written/);
  // The three sections it always asked for are unchanged.
  assert.match(prompt, /Points of agreement/);
  assert.match(prompt, /Remaining disagreements/);
  assert.match(prompt, /Recommendation/);
});

test('council converges only when every member declared no disagreement', () => {
  const signal = (consensus: boolean | null) => ({ role: 'participant', consensus });

  assert.equal(hasConverged({ mode: 'council', roundTurns: [signal(true), signal(true)] }), true);
  assert.equal(hasConverged({ mode: 'council', roundTurns: [signal(true), signal(false)] }), false);
  // A member whose contract could not be read declared nothing, which cannot
  // close a council on its behalf.
  assert.equal(hasConverged({ mode: 'council', roundTurns: [signal(true), signal(null)] }), false);
});
