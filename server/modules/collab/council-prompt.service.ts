/**
 * What a council member is told, as opposed to what a debater is told.
 *
 * The difference is the contract. A debate asks for an argument and a one-line
 * consensus declaration; a council asks for the same argument plus a machine-
 * readable statement of what it rests on — evidence, risks, the test that would
 * settle it, where it disputes the others, and how sure its author is. That text
 * is product, not plumbing: it decides what every stored contract contains, so
 * it lives in one readable place with no I/O anywhere near it.
 *
 * The block is requested as JSON inside a fence rather than through a
 * structured-output channel because no such channel exists across both Claude
 * and Codex here. The parser is built for that reality: a member who ignores
 * the format costs its own contract, never the run.
 */

import type { PromptParticipant } from './collab-prompt.service.js';

export const councilFraming = (self: PromptParticipant): string =>
  `You are ${self.name}, a member of a council examining the topic below.
A council is not a debate to be won. Your job is to state what you actually checked, what you think could go wrong, what would settle the question, and how sure you are — and to change your position when the evidence says you should.
Engage with the other members' most recent positions specifically: name the claim you are answering and say exactly where you think it fails.`;

/** The exact shape `parseCouncilContract` reads back. */
export const COUNCIL_CONTRACT_INSTRUCTIONS = [
  'Your answer has two parts: your reasoning in prose, and then one JSON object as the very last thing you write, inside a fenced ```json block.',
  'The object must have exactly these five keys:',
  `{
  "evidence": [{ "observation": "a concrete thing you checked", "source": "file:line, symbol, command or URL it came from" }],
  "risks": [{ "risk": "what goes wrong if your position is followed", "severity": "low | medium | high" }],
  "tests": [{ "test": "a check that would settle this", "status": "proposed | executed", "result": "what it produced, when you ran it" }],
  "disagreements": [{ "with": "the member you are disputing, or \\"premise\\" for the topic itself", "point": "what you dispute and why" }],
  "confidence": { "value": 0-100, "rationale": "one line: what your number rests on" }
}`,
  [
    'Rules for the block:',
    '- All five keys are required. Use an empty array when you genuinely have nothing to list.',
    '- An empty "disagreements" array means you accept everything said so far. The council ends early when every member sends one, so do not empty it to be agreeable.',
    '- "evidence" is for things you checked in the repository or read in the transcript. An inference is not evidence — put it in your prose.',
    '- "confidence" is about your own position, not about the group. 100 means you would act on it unreviewed.',
    '- Write the block once, at the end, and do not split it across several blocks.',
  ].join('\n'),
].join('\n\n');

/**
 * The budget, stated as a number the member can act on.
 *
 * Telling a model its allowance is not enforcement — the round loop is — but it
 * is the half that produces a short answer instead of a truncated one.
 */
export function councilBudgetNote(input: {
  totalTokens: number;
  maxTurns: number;
  tokenAllowance: number;
}): string {
  return [
    `Budget: this council may spend about ${input.totalTokens.toLocaleString('en-US')} tokens across at most ${input.maxTurns} turns, which leaves roughly ${input.tokenAllowance.toLocaleString('en-US')} tokens for yours.`,
    'Read what you need to read, then answer within it. The run stops when the budget is spent, whether or not the council has concluded, so a long restatement of the transcript costs the council a turn it may need.',
  ].join('\n');
}
