/**
 * Names a session from the prompt that opened it.
 *
 * A session row is inserted before its first prompt exists, so it starts with
 * no title and the sidebar shows a placeholder. The Claude CLI only writes an
 * `ai-title` for interactive sessions, never for SDK-driven ones, so app
 * sessions would keep the raw first prompt (or nothing) forever.
 *
 * The title is settled in two steps so the sidebar never waits on a model:
 *   1. Synchronously: a ticket reference found in the prompt (`DOD-5702`,
 *      `fetcher#17028`) or, failing that, the prompt's first line, clipped.
 *   2. In the background, only when no ticket was found: one detached model
 *      turn rewrites the prompt into a short title. It replaces the quick
 *      title only if nobody renamed the session in the meantime.
 */

// Type-only import, erased at compile time: no runtime edge back to a module
// that already depends on this one. Same seam `/btw` and the handoff summary
// use, so the entrypoint hands over one function for all three.
import type { EphemeralQuery } from '@/modules/commands/index.js';
import { sessionsDb } from '@/modules/database/index.js';
import { deriveQuickTitle, extractTicketReference } from '@/modules/providers/services/session-title-derive.js';
import { broadcastSessionUpserted } from '@/modules/providers/services/sessions-watcher.service.js';
import { normalizeSessionName } from '@/shared/utils.js';

/** Ceiling on one title run: past this the quick title simply stays. */
const TITLE_TIMEOUT_MS = 30_000;

/** Cheapest model that follows a one-line format reliably. */
const TITLE_MODEL = 'haiku';

/** Names the synchronizers assign when a transcript carries no usable title. */
const PLACEHOLDER_TITLE = /^Untitled .+ Session$/i;

const TITLE_INSTRUCTIONS = [
  'Write a title for a chat session that opens with the request below.',
  'Rules: at most 8 words, in the same language as the request, no quotes,',
  'no trailing period, no leading slash command. Reply with the title only.',
  '',
  '---',
  '',
].join('\n');

let titleQuery: EphemeralQuery | null = null;

/** Called once at boot by the server entrypoint, which owns the SDK import. */
export function configureSessionTitleRuntime(query: EphemeralQuery): void {
  titleQuery = query;
}

function hasUsableTitle(customName: string | null | undefined): boolean {
  const trimmed = customName?.trim() ?? '';
  return trimmed.length > 0 && !PLACEHOLDER_TITLE.test(trimmed);
}

/** One model answer reduced to a single clean line, or null when unusable. */
function cleanModelTitle(answer: string): string | null {
  const line = answer.split(/\r?\n/).map((part) => part.trim()).find((part) => part.length > 0) ?? '';
  const stripped = line.replace(/^["'“”«]+|["'“”»]+$/g, '').replace(/[.。]+$/, '').trim();
  return stripped.length > 0 && stripped.length <= 120 ? stripped : null;
}

async function requestModelTitle(
  prompt: string,
  options: { cwd?: string; profileId?: string },
): Promise<string | null> {
  if (!titleQuery) {
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Session title run timed out')), TITLE_TIMEOUT_MS);
  });

  try {
    const answer = await Promise.race([
      titleQuery(`${TITLE_INSTRUCTIONS}${prompt}`, { ...options, model: TITLE_MODEL }),
      deadline,
    ]);
    return cleanModelTitle(answer);
  } catch (error) {
    console.warn('[SessionTitle] Model title skipped:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export interface EnsureSessionTitleInput {
  sessionId: string;
  prompt: string;
  cwd?: string | null;
  profileId?: string | null;
}

/** Persistence seam, swapped by tests; production reads and writes the DB. */
export interface SessionTitleStore {
  readTitle: (sessionId: string) => string | null | undefined;
  writeTitle: (sessionId: string, title: string) => void;
  notify: (sessionId: string) => void;
}

const defaultStore: SessionTitleStore = {
  readTitle: (sessionId) => sessionsDb.getSessionById(sessionId)?.custom_name,
  writeTitle: (sessionId, title) => sessionsDb.updateSessionCustomName(sessionId, title),
  notify: (sessionId) => broadcastSessionUpserted(sessionId),
};

/**
 * Gives an untitled session its title from `prompt`, then upgrades it with a
 * model-written one in the background when no ticket reference was found.
 * Sessions that already have a real title (renamed, indexed, or titled by an
 * earlier turn) are left alone. Never throws: a title is a nicety and must
 * not fail the turn that triggered it.
 */
export async function ensureSessionTitle(
  input: EnsureSessionTitleInput,
  store: SessionTitleStore = defaultStore,
): Promise<void> {
  try {
    if (hasUsableTitle(store.readTitle(input.sessionId))) {
      return;
    }

    const ticket = extractTicketReference(input.prompt);
    const quickTitle = normalizeSessionName(ticket ?? deriveQuickTitle(input.prompt), '');
    if (!quickTitle) {
      return;
    }

    store.writeTitle(input.sessionId, quickTitle);
    store.notify(input.sessionId);
    if (ticket) {
      return;
    }

    const modelTitle = await requestModelTitle(input.prompt, {
      cwd: input.cwd ?? undefined,
      profileId: input.profileId ?? undefined,
    });
    // A rename that landed while the model was thinking wins over the model.
    if (!modelTitle || store.readTitle(input.sessionId) !== quickTitle) {
      return;
    }

    store.writeTitle(input.sessionId, modelTitle);
    store.notify(input.sessionId);
  } catch (error) {
    console.error('[SessionTitle] Failed to title a session:', error);
  }
}
