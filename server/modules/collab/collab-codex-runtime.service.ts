/**
 * The adapter between a collaboration turn and the Codex SDK.
 *
 * The Claude adapter has to assemble read-only out of parts — plan mode, an
 * explicit deny list, and a writer that answers every permission prompt with a
 * refusal — because there the guarantee is a convention this process agreed to
 * honour, and a dropped answer strands the turn. Codex enforces it a layer
 * down: `sandboxMode: 'read-only'` runs whatever the agent executes inside the
 * operating system's own sandbox, so a turn that tries to write fails in the
 * kernel rather than at a callback we remembered to register.
 *
 * `approvalPolicy: 'never'` is what keeps that from turning into a hang, and
 * there is nothing left to answer anyway: the SDK drives `codex exec`, whose
 * event union has no approval event and whose per-turn options carry only an
 * output schema and an abort signal. A request for permission has no channel to
 * arrive on, which is why this file has no counterpart to the Claude adapter's
 * deny-on-prompt handling. Network access and web search are off for the same
 * reason the Claude adapter denies them: an unattended debate billed to the
 * user's plan should not fan out.
 *
 * Only the assistant's final message is kept — reasoning, command output and
 * token accounting are noise in a transcript a human reads as an argument
 * between two accounts.
 */

import type { ModelReasoningEffort, ThreadOptions, Thread, ThreadItem } from '@openai/codex-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import { profilesService } from '@/modules/profiles/index.js';
import { sessionSynchronizerService } from '@/modules/providers/index.js';

import type { CollabRuntime } from './collab-runtime.js';

/** The slice of a Codex thread a turn uses, so tests can stand one up cheaply. */
export type CollabCodexThread = Pick<Thread, 'id' | 'run'>;

export interface CollabCodexClient {
  startThread(options: ThreadOptions): CollabCodexThread;
}

export interface CollabCodexRuntimeDeps {
  /** One client per account; the profile's CODEX_HOME is the isolation seam. */
  createClient?: (profileId: string) => CollabCodexClient;
  /** Overridable seam so tests never reach the session index. */
  archiveSession?: (providerSessionId: string) => Promise<void> | void;
}

/**
 * The whole read-only guarantee, in one object.
 *
 * `skipGitRepoCheck` is not part of it: Codex otherwise refuses to start
 * outside a git repository, and a collaboration reasons about whatever path the
 * user pointed it at. It relaxes a footgun check for humans who might lose
 * uncommitted work, which is moot for a run that cannot write in the first
 * place.
 */
const READ_ONLY_THREAD_OPTIONS: ThreadOptions = {
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  networkAccessEnabled: false,
  webSearchEnabled: false,
  skipGitRepoCheck: true,
};

const NO_ANSWER_ERROR = 'The account returned no answer for this turn.';

let codexDeps: CollabCodexRuntimeDeps = {};

/** Optional: the runtime works unwired, and tests replace the SDK through this. */
export function configureCollabCodexRuntime(deps: CollabCodexRuntimeDeps): void {
  codexDeps = deps;
}

type ProfileEnvResolver = (profileId: string) => Record<string, string>;

/**
 * Binds a client to one account: `CODEX_HOME` decides whose credentials the CLI
 * reads, which is the only thing keeping two participants from sharing a login.
 * The host environment has to be merged in because the SDK stops inheriting
 * `process.env` the moment `env` is provided, and a profile with no environment
 * of its own yields `undefined` so the client keeps inheriting it untouched.
 *
 * The chat path's helper does exactly this, but it lives outside
 * `server/modules` and the backend lint boundaries do not let a module reach
 * there — the same reason the Claude adapter takes its SDK by injection.
 */
export function buildCollabCodexClientOptions(
  profileId: string,
  resolveEnv: ProfileEnvResolver = (id) => profilesService.resolveEnv(id),
): { env: Record<string, string> } | undefined {
  const profileEnv = resolveEnv(profileId);
  if (Object.keys(profileEnv).length === 0) return undefined;

  // `process.env` is typed with optional values; spreading a real environment
  // never produces one, and the SDK wants a plain string map.
  return { env: { ...process.env, ...profileEnv } as Record<string, string> };
}

/**
 * Loaded here and nowhere else: the SDK holds a background handle open that
 * would stop the test runner from exiting, and tests inject their own client,
 * so the import never happens under test.
 */
async function createDefaultClient(profileId: string): Promise<CollabCodexClient> {
  const { Codex } = await import('@openai/codex-sdk');
  return new Codex(buildCollabCodexClientOptions(profileId));
}

/**
 * Keeps the transcript a turn leaves behind out of the chat sidebar.
 *
 * Every turn makes the CLI write a rollout file into the participant profile's
 * CODEX_HOME and the session index picks up whatever it finds there, so a
 * three-round debate would surface a handful of chats nobody started. Indexing
 * has to run first: archiving a row that does not exist yet changes nothing and
 * the next pass would surface the transcript anyway. Never throws: housekeeping
 * does not fail a turn that has already been paid for.
 */
async function hideTurnSession(providerSessionId: string | null): Promise<void> {
  if (!providerSessionId) return;

  try {
    if (codexDeps.archiveSession) {
      await codexDeps.archiveSession(providerSessionId);
      return;
    }
    await sessionSynchronizerService.synchronizeSessions();
    const session = sessionsDb.getSessionByProviderSessionId(providerSessionId);
    if (session) sessionsDb.updateSessionIsArchived(session.session_id, true);
  } catch (error) {
    console.error('[collab] could not archive the session left behind by a turn:', error);
  }
}

/**
 * A turn that failed outright rejects on its own; this is for the softer kind,
 * where the stream reported a problem as an item and produced no answer. Read
 * only when there is no text: a hiccup the model recovered from should not cost
 * the whole collaboration, which is what a rejection here would do.
 */
function firstReportedError(items: ThreadItem[] | undefined): string | null {
  for (const item of items ?? []) {
    if (item.type === 'error' && item.message) return item.message;
  }
  return null;
}

/**
 * The SDK's own effort union, used only to narrow a value that already passed
 * validation. `minimal` is listed because the SDK accepts it, not because this
 * application offers it: the picker is scoped to the provider catalog, which
 * does not, so a seat can only reach the values the rest of the app exposes.
 */
const CODEX_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  'minimal', 'low', 'medium', 'high', 'xhigh',
];

function toCodexReasoningEffort(effort: string | undefined): ModelReasoningEffort | undefined {
  return CODEX_REASONING_EFFORTS.find((candidate) => candidate === effort);
}

/** The engine's runtime seam, filled in with a real Codex call. */
export const collabCodexRuntime: CollabRuntime = async ({
  prompt, profileId, cwd, signal, model, effort,
}) => {
  const client = codexDeps.createClient?.(profileId) ?? (await createDefaultClient(profileId));
  const reasoningEffort = toCodexReasoningEffort(effort);
  // Spread conditionally rather than passing `undefined`: `ThreadOptions` keys
  // that are absent leave the CLI on its configured default, which is the
  // behaviour a seat that picked nothing is asking for.
  const thread = client.startThread({
    ...READ_ONLY_THREAD_OPTIONS,
    workingDirectory: cwd,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {}),
  });

  // The engine owns the per-turn deadline; the SDK forwards the signal to the
  // CLI process it spawned, so an abandoned turn stops costing tokens.
  try {
    const turn = await thread.run(prompt, { signal });

    const answer = turn.finalResponse?.trim() ?? '';
    if (answer) return answer;
    throw new Error(firstReportedError(turn.items) ?? NO_ANSWER_ERROR);
  } finally {
    await hideTurnSession(thread.id);
  }
};
