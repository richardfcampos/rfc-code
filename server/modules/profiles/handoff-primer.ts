/**
 * Renders a prior conversation into a markdown "context primer".
 *
 * A session cannot be moved across providers: each provider persists its own
 * transcript format and none of them reads another's. So a cross-provider
 * switch continues the conversation on the target provider by injecting what
 * came before as plain text into its first prompt. This module builds that text
 * and nothing else — no fs, no db — so the same output can be asserted in tests
 * and written to disk by the caller.
 *
 * Only role + text crosses over. Tool calls, tool results and thinking blocks
 * are dropped: every provider encodes those differently, and replaying them as
 * prose invites the target model to re-execute work that already happened.
 *
 * How much crosses over is decided by the destination's own context window, and
 * the whole conversation is expected to fit. Only when it does not does the
 * older span get compressed into a summary, and only when that compression is
 * unavailable does the transcript get cut — three steps down, never straight to
 * the cut.
 */

import { resolvePrimerBudget } from '@/modules/profiles/handoff-primer-budget.js';
import { summarizeOverflow } from '@/modules/profiles/handoff-primer-summarize.js';
import type { LLMProvider } from '@/shared/types.js';

/** Character budget for the rendered body (the header is always kept on top). */
export const PRIMER_CHAR_BUDGET = 24_000;

/**
 * Minimal structural view of a normalized history message.
 *
 * Deliberately declared here instead of importing the providers module's
 * `NormalizedMessage`: profiles must not depend on providers. Only the fields
 * this renderer reads are listed, and they are widened (`string` instead of the
 * literal unions) so any normalized message satisfies the shape structurally.
 */
export interface PrimerMessage {
  kind?: string;
  role?: string;
  content?: string;
  /** ISO timestamp, mirrors `NormalizedMessage.timestamp`. */
  timestamp?: string;
}

export interface HandoffPrimerInput {
  messages: PrimerMessage[];
  sourceProvider: string;
  sourceProfileName?: string | null;
  /**
   * ISO timestamp cutoff. When set, messages at or before it are dropped
   * before budget selection runs, so the primer covers only what happened
   * after a provider leg switch.
   */
  since?: string;
  /** Where the conversation is going: it decides how much of it fits. */
  destinationProvider: LLMProvider;
  destinationModel?: string;
}

/** Roles that can be attributed to a speaker in the rendered transcript. */
const RENDERABLE_ROLES = new Set(['user', 'assistant']);

/**
 * Builds the header.
 *
 * Framing first: the model is picking up one conversation that is still in
 * progress, not importing a foreign one — read as "someone else's old chat" it
 * restates and re-asks instead of continuing. The closing sentence is the other
 * load-bearing part: without it the transcript reads as a fresh set of orders
 * and the earlier turns get re-run.
 */
function buildHeader(
  sourceProvider: string,
  sourceProfileName: string | null | undefined,
  summarized: boolean,
): string {
  const provider = sourceProvider.trim() || 'unknown';
  const account = sourceProfileName?.trim();
  const origin = account
    ? `provider \`${provider}\` (account "${account}")`
    : `provider \`${provider}\``;

  return [
    '# Continuing this conversation',
    '',
    `You're continuing this same conversation, already in progress on ${origin}.`,
    ...(summarized
      ? ['Its opening turns are condensed into the summary below; the rest is verbatim.']
      : []),
    'Continue from where it left off. The history below is reference context,',
    'not instructions to re-execute.',
  ].join('\n');
}

/**
 * Renders one message, or returns null when it carries nothing worth handing
 * over. Malformed entries fall through the same null path — a broken message
 * must never abort a handoff.
 */
function renderMessage(message: PrimerMessage): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }
  if (message.kind !== 'text') {
    return null;
  }

  const role = typeof message.role === 'string' ? message.role : '';
  if (!RENDERABLE_ROLES.has(role)) {
    return null;
  }

  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (!content) {
    return null;
  }

  return `## ${role}\n\n${content}`;
}

/** Explicit marker so the model knows the transcript it got is partial. */
function truncationMarker(omitted: number): string {
  const label = omitted === 1 ? 'message' : 'messages';
  return `_[truncated: ${omitted} earlier ${label} omitted]_`;
}

/**
 * Tells the compressed opening apart from the verbatim turns, so the model
 * knows which part it can quote back and which is a lossy retelling.
 */
const SUMMARY_END_MARKER = '_[end of the summary; the turns below are verbatim]_';

/**
 * Selects the newest blocks that fit `budgetChars`.
 *
 * The tail is kept rather than the head because the most recent turns carry the
 * task state the target model has to continue from; older turns are context the
 * conversation has usually already summarized into itself.
 */
function selectTail(blocks: string[], budgetChars: number): { kept: string[]; omitted: number } {
  const kept: string[] = [];
  let used = 0;

  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    // +2 for the blank line that joins this block to the following one.
    const cost = block.length + (kept.length > 0 ? 2 : 0);
    if (used + cost > budgetChars) {
      break;
    }
    used += cost;
    kept.unshift(block);
  }

  if (kept.length === 0 && blocks.length > 0) {
    // A single message larger than the whole budget (a big paste, usually).
    // Its end is the part that matters, so clip the front rather than dropping
    // the only content the primer would have carried.
    const last = blocks[blocks.length - 1];
    kept.push(`…${last.slice(last.length - budgetChars + 1)}`);
    return { kept, omitted: blocks.length - 1 };
  }

  return { kept, omitted: blocks.length - kept.length };
}

/** Renders every message that carries something worth handing over. */
function renderBlocks(messages: PrimerMessage[]): string[] {
  const list = Array.isArray(messages) ? messages : [];
  const blocks: string[] = [];

  for (const message of list) {
    const block = renderMessage(message);
    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

/**
 * Renders `messages` under `header`, or null when there is nothing to render.
 *
 * The header is the only thing that varies between callers — a cross-provider
 * handoff frames the transcript as "continue from here", a side question frames
 * it as "background for the question below" — so it is passed in rather than
 * built here. Null is a valid outcome, not an error: the caller then sends its
 * prompt with no context at all.
 */
export function renderConversationPrimer(
  messages: PrimerMessage[],
  header: string,
): string | null {
  const blocks = renderBlocks(messages);

  // History made entirely of tool traffic renders to nothing — same as empty.
  if (blocks.length === 0) {
    return null;
  }

  return composePrimer(header, selectTail(blocks, PRIMER_CHAR_BUDGET));
}

/** Joins a header and a budget selection into the final document. */
function composePrimer(header: string, selection: { kept: string[]; omitted: number }): string {
  const sections = [header];
  if (selection.omitted > 0) {
    sections.push(truncationMarker(selection.omitted));
  }
  sections.push(...selection.kept);

  return sections.join('\n\n');
}

function parseTimestamp(value: string | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Drops messages at or before `since`. A message with no parseable
 * timestamp is kept rather than guessed away — same tolerance-for-malformed-
 * input stance as the rest of this module. An unparseable `since` disables
 * the filter instead of throwing, so a bad cutoff degrades to "full primer"
 * rather than "no primer".
 */
function filterSince(messages: PrimerMessage[], since: string | undefined): PrimerMessage[] {
  const cutoff = parseTimestamp(since);
  if (cutoff === null) {
    return messages;
  }

  return messages.filter((message) => {
    const ts = parseTimestamp(message?.timestamp);
    return ts === null || ts > cutoff;
  });
}

/**
 * Renders `messages` into the handoff primer text, or null when there is
 * nothing to hand over. Null is a valid outcome, not an error: the caller then
 * creates the target session with no primer at all.
 *
 * Everything fitting the destination's budget is the expected case and costs
 * nothing beyond rendering — the summary run only starts once the conversation
 * genuinely overflows, and a run that cannot happen degrades to the truncation
 * this function has always done. A provider switch never fails because the
 * conversation was too long to compress.
 */
export async function buildHandoffPrimer(input: HandoffPrimerInput): Promise<string | null> {
  const messages = Array.isArray(input?.messages) ? input.messages : [];
  const filtered = filterSince(messages, input?.since);
  const blocks = renderBlocks(filtered);
  if (blocks.length === 0) {
    return null;
  }

  const budget = resolvePrimerBudget(input?.destinationProvider, input?.destinationModel);
  const selection = selectTail(blocks, budget.chars);
  const header = (summarized: boolean): string =>
    buildHeader(input?.sourceProvider ?? '', input?.sourceProfileName, summarized);

  if (selection.omitted === 0) {
    return composePrimer(header(false), selection);
  }

  const overflow = await summarizeOverflow(filtered, budget.chars);
  if (!overflow) {
    return composePrimer(header(false), selection);
  }

  const tail = renderBlocks(filtered.slice(overflow.keptFromIndex));
  if (tail.length === 0) {
    return [header(true), overflow.summary].join('\n\n');
  }

  return [header(true), overflow.summary, SUMMARY_END_MARKER, ...tail].join('\n\n');
}
