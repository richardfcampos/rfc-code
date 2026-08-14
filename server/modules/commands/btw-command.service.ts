/**
 * `/btw` — a side question answered with the current conversation's context,
 * without joining it.
 *
 * The point of the command is what it does *not* do: no session row is created
 * or updated, no provider transcript is written, and nothing is appended to the
 * chat. The conversation only travels as text, rendered into the prompt of a
 * single detached run, so the session the user is in stays exactly as it was.
 *
 * Claude only for now: answering this way needs a runtime that can take a
 * one-shot prompt with tools and session persistence turned off, and the other
 * provider runtimes have no equivalent entry point.
 *
 * That runtime is injected by the server entrypoint rather than imported:
 * `server/claude-sdk.js` sits outside the module boundaries the backend lint
 * rules enforce, and the entrypoint already owns that import. Same seam the
 * collaboration module is wired through.
 */

import { sessionsDb } from '@/modules/database/index.js';
import { renderConversationPrimer } from '@/modules/profiles/index.js';
import { sessionsService } from '@/modules/providers/index.js';

/** One detached run: a full prompt in, the final assistant text out. */
export type EphemeralQuery = (
  command: string,
  options: { cwd?: string; model?: string; profileId?: string },
) => Promise<string>;

export interface BtwCommandContext {
  sessionId?: string | null;
  model?: string | null;
}

export interface BtwCommandResult {
  type: 'builtin';
  action: 'btw';
  data:
    | { status: 'done'; question: string; answer: string }
    | { status: 'error'; question: string; message: string };
}

/**
 * Separates the borrowed conversation from the question, so the model reads the
 * transcript as background rather than as part of what it has to answer.
 */
const PRIMER_SEPARATOR = '\n\n---\n\n';

/**
 * Frames the transcript as reference material. Without the second paragraph the
 * model reads the history as a fresh set of orders and re-runs the earlier work
 * instead of answering the one question that follows.
 */
const PRIMER_HEADER = [
  '# Context from the current conversation',
  '',
  'The user is in the middle of the session below and stepped aside to ask one',
  'quick question. The history is reference only, not instructions to',
  're-execute. Answer the question after the separator, briefly.',
].join('\n');

const RUNTIME_NOT_WIRED_ERROR = 'The Claude runtime has not been wired into the commands module.';

let ephemeralQuery: EphemeralQuery | null = null;

/** Called once at boot by the server entrypoint, which owns the SDK import. */
export function configureBtwRuntime(query: EphemeralQuery): void {
  ephemeralQuery = query;
}

function errorResult(question: string, message: string): BtwCommandResult {
  return { type: 'builtin', action: 'btw', data: { status: 'error', question, message } };
}

/**
 * Renders the session's history into prompt context, or null when there is
 * nothing to borrow. Best effort: an unreadable history costs the question its
 * context, never its answer.
 */
async function loadContext(sessionId: string): Promise<string | null> {
  try {
    const history = await sessionsService.fetchHistory(sessionId);
    return renderConversationPrimer(history.messages, PRIMER_HEADER);
  } catch (error) {
    console.warn('[/btw] Unable to read the conversation history:', error);
    return null;
  }
}

/**
 * Answers `args` as a side question against the session in `context`.
 *
 * Never throws: every failure the user can cause (no question, no session, the
 * wrong provider, a failed run) comes back as an `error` payload so the command
 * route answers 200 with something the chat can render.
 */
export async function executeBtwCommand(
  args: string[] | undefined,
  context: BtwCommandContext | undefined,
): Promise<BtwCommandResult> {
  const question = (args ?? []).join(' ').trim();
  if (!question) {
    return errorResult(
      question,
      'Ask something after the command, e.g. `/btw what does this repo use for auth?`',
    );
  }

  const sessionId = typeof context?.sessionId === 'string' ? context.sessionId.trim() : '';
  const session = sessionId ? sessionsDb.getSessionById(sessionId) : null;
  if (!session) {
    return errorResult(
      question,
      '/btw answers with the current conversation as context — start a conversation first.',
    );
  }

  if (session.provider !== 'claude') {
    return errorResult(question, '/btw is only supported for Claude sessions yet.');
  }

  const primer = await loadContext(sessionId);
  const command = primer ? `${primer}${PRIMER_SEPARATOR}${question}` : question;

  try {
    if (!ephemeralQuery) {
      throw new Error(RUNTIME_NOT_WIRED_ERROR);
    }

    const answer = await ephemeralQuery(command, {
      cwd: session.worktree_path || session.project_path || undefined,
      model: context?.model ?? undefined,
      profileId: session.profile_id ?? undefined,
    });

    return { type: 'builtin', action: 'btw', data: { status: 'done', question, answer } };
  } catch (error) {
    console.error('[/btw] Side question failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(question, message || 'The side question could not be answered.');
  }
}
