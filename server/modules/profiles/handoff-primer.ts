/**
 * Renders a prior conversation into a markdown "context primer".
 *
 * A session cannot be moved across providers: each provider persists its own
 * transcript format and none of them reads another's. So a cross-provider
 * switch creates a *new* session on the target provider and injects the earlier
 * conversation as plain text into its first prompt. This module builds that
 * text and nothing else — it is pure (no fs, no db, no network) so the same
 * output can be asserted in tests and written to disk by the caller.
 *
 * Only role + text crosses over. Tool calls, tool results and thinking blocks
 * are dropped: every provider encodes those differently, and replaying them as
 * prose invites the target model to re-execute work that already happened.
 */

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
}

export interface HandoffPrimerInput {
  messages: PrimerMessage[];
  sourceProvider: string;
  sourceProfileName?: string | null;
}

/** Roles that can be attributed to a speaker in the rendered transcript. */
const RENDERABLE_ROLES = new Set(['user', 'assistant']);

/**
 * Builds the header.
 *
 * The second paragraph is the load-bearing part: without it the target model
 * reads the transcript as a fresh set of orders and re-runs the earlier turns.
 */
function buildHeader(sourceProvider: string, sourceProfileName?: string | null): string {
  const provider = sourceProvider.trim() || 'unknown';
  const account = sourceProfileName?.trim();
  const origin = account
    ? `provider \`${provider}\` (account "${account}")`
    : `provider \`${provider}\``;

  return [
    '# Context from an earlier conversation',
    '',
    `This conversation started in another session, on ${origin}.`,
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
 * Selects the newest blocks that fit the budget.
 *
 * The tail is kept rather than the head because the most recent turns carry the
 * task state the target model has to continue from; older turns are context the
 * conversation has usually already summarized into itself.
 */
function selectTail(blocks: string[]): { kept: string[]; omitted: number } {
  const kept: string[] = [];
  let used = 0;

  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    // +2 for the blank line that joins this block to the following one.
    const cost = block.length + (kept.length > 0 ? 2 : 0);
    if (used + cost > PRIMER_CHAR_BUDGET) {
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
    kept.push(`…${last.slice(last.length - PRIMER_CHAR_BUDGET + 1)}`);
    return { kept, omitted: blocks.length - 1 };
  }

  return { kept, omitted: blocks.length - kept.length };
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
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) {
    return null;
  }

  const blocks: string[] = [];
  for (const message of list) {
    const block = renderMessage(message);
    if (block) {
      blocks.push(block);
    }
  }

  // History made entirely of tool traffic renders to nothing — same as empty.
  if (blocks.length === 0) {
    return null;
  }

  const { kept, omitted } = selectTail(blocks);
  const sections = [header];
  if (omitted > 0) {
    sections.push(truncationMarker(omitted));
  }
  sections.push(...kept);

  return sections.join('\n\n');
}

/**
 * Renders `messages` into the handoff primer text, or null when there is
 * nothing to hand over. Null is a valid outcome, not an error: the caller then
 * creates the target session with no primer at all.
 */
export function buildHandoffPrimer(input: HandoffPrimerInput): string | null {
  return renderConversationPrimer(
    input?.messages,
    buildHeader(input?.sourceProvider ?? '', input?.sourceProfileName),
  );
}
