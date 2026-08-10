/**
 * Pure prompt construction and consensus parsing for collaborations between
 * two or more accounts.
 *
 * A collaboration is only as good as what each participant is told: who else is
 * in the room, what has already been said, and what "done" looks like. Keeping
 * that wording here — with no I/O, no database and no provider call — means the
 * product text can be read, reviewed and unit-tested on its own, while the
 * engine stays a plain loop over rounds.
 *
 * Convergence is signalled by a `CONSENSUS:` line at the end of an answer rather
 * than by structured output because participants are ordinary chat turns from a
 * coding agent: no tool-call or JSON-schema channel is available across
 * providers, and forcing one would cost us the readable prose the user reads in
 * the UI. A text protocol degrades gracefully — a line we cannot parse simply
 * means "no agreement declared", which is the safe reading, and the round
 * ceiling always ends the run anyway.
 */

/** Collaboration shapes are structural on purpose: callers pass their own types. */
export type CollabPromptMode = 'debate' | 'review' | 'vote';

export interface PromptParticipant {
  name: string;
  role: string;
}

export interface PromptTranscriptEntry extends PromptParticipant {
  round: number;
  content: string;
}

export interface TurnPromptInput {
  mode: CollabPromptMode;
  topic: string;
  round: number;
  maxRounds: number;
  self: PromptParticipant;
  others: PromptParticipant[];
  transcript: PromptTranscriptEntry[];
}

export interface VerdictPromptInput {
  topic: string;
  mode: CollabPromptMode;
  transcript: PromptTranscriptEntry[];
}

export interface RoundTurnSignal {
  role: string;
  consensus: boolean | null;
}

const GROUND_RULES = [
  'Ground rules:',
  '- The repository under discussion is available read-only at your current working directory. You may read files to ground your argument in what the code actually does; do not attempt to edit, write or run anything that changes the repository.',
  '- Be concise and concrete: name specific files, functions and trade-offs instead of restating general principles.',
  '- Disagreement is more useful than politeness. If you think the other position is wrong, say so and say exactly why.',
].join('\n');

/** The exact contract the engine parses back with `parseConsensus`. */
const CONSENSUS_CONTRACT = [
  'End your answer with one last line, in exactly this format:',
  'CONSENSUS: YES   (if you fully agree with the other participant\'s most recent position)',
  'CONSENSUS: NO — <what blocks agreement, in one sentence>',
].join('\n');

function finalRoundNote(round: number, maxRounds: number): string | null {
  if (round < maxRounds) return null;
  return `This is the final round (${round} of ${maxRounds}). There will be no further exchange, so state your best final position now, and say what would still be needed to change your mind.`;
}

function describeOthers(others: PromptParticipant[]): string {
  if (others.length === 0) return 'You are the only participant.';
  const listed = others.map((other) => `${other.name} (${other.role})`).join(', ');
  return `Other participants: ${listed}.`;
}

function renderTranscript(transcript: PromptTranscriptEntry[]): string {
  if (transcript.length === 0) {
    return 'Transcript so far:\n(nothing yet — you are opening the discussion)';
  }
  const blocks = transcript.map(
    (entry) => `--- Round ${entry.round} — ${entry.name} (${entry.role}) ---\n${entry.content}`,
  );
  return `Transcript so far:\n${blocks.join('\n\n')}`;
}

const debateFraming = (self: PromptParticipant): string =>
  `You are ${self.name}, taking part in a debate about the topic below.
Engage with the other participant's most recent position specifically: name the claim you are answering, say where you agree, and attack the part you believe is wrong.
Do not restate your own earlier argument. Add a new point, concede what has already been answered, or sharpen what is still open.`;

const reviewFraming = (self: PromptParticipant): string =>
  self.role === 'reviewer'
    ? `You are ${self.name}, the reviewer.
Critique the author's most recent work concretely: what is wrong, why it is wrong, and what evidence or change would make you agree.
Prefer a few substantive objections over a long list of nits, and skip praise that carries no information.`
    : `You are ${self.name}, the author.
Produce the work the topic asks for. If the reviewer has already responded, revise it in light of their critique.
State plainly which of their points you accepted and which you rejected, with your reason for each rejection.`;

const voteFraming = (self: PromptParticipant): string =>
  `You are ${self.name}, answering the topic below independently.
You are NOT seeing the other participants' answers, and they are not seeing yours. That is deliberate: your answer must not be anchored by theirs.
Give your own position, the reasoning behind it, and the main way it could turn out to be wrong. Do not address the other participants — an arbiter compares the answers afterwards.`;

function framingFor(mode: CollabPromptMode, self: PromptParticipant): string {
  if (mode === 'review') return reviewFraming(self);
  if (mode === 'vote') return voteFraming(self);
  return debateFraming(self);
}

/** Builds the prompt for a single participant turn. */
export function buildTurnPrompt(input: TurnPromptInput): string {
  const { mode, topic, round, maxRounds, self, others, transcript } = input;
  const isVote = mode === 'vote';

  const sections: (string | null)[] = [
    framingFor(mode, self),
    describeOthers(others),
    `Topic:\n${topic}`,
    // Vote is answered blind by design, so the transcript is never shown.
    isVote ? null : renderTranscript(transcript),
    GROUND_RULES,
    // A vote is a single independent answer, so announcing a "final round" would
    // imply an exchange that never happens.
    isVote ? null : finalRoundNote(round, maxRounds),
    isVote ? null : CONSENSUS_CONTRACT,
  ];

  return sections.filter((section): section is string => Boolean(section)).join('\n\n');
}

/** Builds the arbiter prompt that closes a collaboration with a verdict. */
export function buildVerdictPrompt(input: VerdictPromptInput): string {
  const modeNote =
    input.mode === 'vote'
      ? 'The participants answered independently, without seeing each other, so expect overlap and contradiction rather than a conversation.'
      : 'The participants answered each other in rounds, so read the transcript in order.';

  return [
    'You are the arbiter of a collaboration between several accounts. Your job is to synthesize the discussion below, not to continue it.',
    modeNote,
    `Topic:\n${input.topic}`,
    renderTranscript(input.transcript),
    [
      'Write your synthesis in three sections:',
      '1. Points of agreement — what the participants genuinely converged on.',
      '2. Remaining disagreements — each side stated fairly, in the strongest form its own author would recognise.',
      '3. Recommendation — your final recommendation and the reasoning that supports it.',
    ].join('\n'),
    [
      'Represent every position faithfully, including the ones you argued against; do not quietly strengthen your own side.',
      'If no agreement was reached, say so plainly instead of inventing a middle ground.',
      'The repository is available read-only at your current working directory; you may read files but must not change anything.',
      'Be concise and concrete.',
    ].join('\n'),
  ].join('\n\n');
}

/**
 * Reads the last consensus declaration in a turn. Anything missing or malformed
 * is `null`, which the engine treats as "did not converge" — a model that
 * ignored the format is not a reason to end the collaboration.
 */
export function parseConsensus(content: string): boolean | null {
  if (typeof content !== 'string') return null;

  // Leading markdown decoration (bold, quote, bullet, heading) is tolerated.
  const pattern = /^[\s>*_#-]*CONSENSUS:\s*(YES|NO)\b/gim;
  let last: string | null = null;
  for (const match of content.matchAll(pattern)) {
    last = match[1];
  }

  if (last === null) return null;
  return last.toUpperCase() === 'YES';
}

/** Per-mode stop rule over the consensus signals of one completed round. */
export function hasConverged(input: {
  mode: CollabPromptMode;
  roundTurns: RoundTurnSignal[];
}): boolean {
  const { mode, roundTurns } = input;
  if (mode === 'vote') return false;
  if (roundTurns.length === 0) return false;

  if (mode === 'review') {
    // The author does not vote on their own work.
    const reviewer = roundTurns.find((turn) => turn.role === 'reviewer');
    return reviewer?.consensus === true;
  }

  return roundTurns.every((turn) => turn.consensus === true);
}
