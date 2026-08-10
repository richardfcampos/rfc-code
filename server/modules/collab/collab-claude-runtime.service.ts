/**
 * The adapter between a collaboration turn and the Claude SDK.
 *
 * It drives the SDK through the same duck-typed writer the commit-message
 * generator uses — a plain object with `send`/`setSessionId` — because the SDK
 * entry point was written for a websocket and a turn has no socket. Only
 * assistant text is kept: tool traffic, status frames and token accounting are
 * noise in a transcript a human reads as an argument between two accounts.
 *
 * Participants run in plan mode *and* under an explicit deny list, because plan
 * mode alone is not read-only: it waves through web access and subagents, and
 * it leaves the target repository's settings free to allow anything at all to a
 * run nobody is watching. The guarantee is therefore narrow and worth stating
 * exactly: no tool that writes, runs a command, reaches the network or spawns a
 * subagent executes. Project settings, hooks and MCP servers still load, so a
 * repository shipping a mutating MCP tool falls outside it. Anything else that
 * asks for permission is denied on the spot — the account that would answer the
 * prompt is not watching.
 *
 * The SDK functions are injected by the server entrypoint instead of imported:
 * `server/claude-sdk.js` sits outside the module boundaries the backend lint
 * rules enforce, and the entrypoint already owns that import for the websocket
 * runtimes. Same seam, same reason.
 */

import { sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/index.js';

import type { CollabRuntime } from './collab-runtime.js';

type ClaudeQuery = (prompt: string, options: Record<string, unknown>, writer: unknown) => Promise<unknown>;

export interface CollabClaudeRuntimeDeps {
  query: ClaudeQuery;
  /** Stops an in-flight query, addressed by the provider-native session id. */
  abortSession?: (providerSessionId: string) => boolean | Promise<boolean>;
  /** Answers the SDK's tool-permission prompts, which nobody else will here. */
  resolveToolApproval?: (requestId: string, decision: { allow: boolean; message?: string }) => void;
  /** Overridable seam so tests never reach the session index. */
  archiveSession?: (providerSessionId: string) => Promise<void> | void;
}

/**
 * Read-only tools a participant may use without being asked. Plan mode already
 * clears Read; these are the search tools that would otherwise stall a turn on
 * a prompt with no one to answer it.
 *
 * `Skill` is here so a topic can invoke a skill: loading one only injects its
 * instructions into the turn's context — every action those instructions could
 * ask for still goes through the deny list and plan mode below. Without it the
 * call becomes a permission prompt, and this runtime answers every prompt with
 * "no", so the skill would silently never load.
 */
const READ_ONLY_TOOLS = ['Grep', 'Glob', 'NotebookRead', 'Skill'];

/**
 * Tools no participant may reach, whatever the target repository's settings say
 * and whatever plan mode would wave through. Web access and `Task` are on the
 * list for the cost model rather than for safety: one subagent fan-out turns
 * the per-turn spend the user was warned about into an open-ended number.
 */
const DISALLOWED_TOOLS = [
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Bash', 'BashOutput', 'KillShell',
  'WebFetch', 'WebSearch', 'Task',
];

const PERMISSION_DENIED_MESSAGE =
  'This collaboration is read-only: answer with text instead of using this tool.';

const NO_ANSWER_ERROR = 'The account returned no answer for this turn.';

const RUNTIME_NOT_WIRED_ERROR =
  'The Claude runtime has not been wired into the collaboration module.';

let claudeDeps: CollabClaudeRuntimeDeps | null = null;

/** Called once at boot by the server entrypoint, which owns the SDK import. */
export function configureCollabClaudeRuntime(deps: CollabClaudeRuntimeDeps): void {
  claudeDeps = deps;
}

type WriterMessage = { kind?: unknown; role?: unknown; content?: unknown; requestId?: unknown };

/** The writer receives normalized message objects; older callers send strings. */
function readWriterMessage(data: unknown): WriterMessage | null {
  try {
    const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data;
    return typeof parsed === 'object' && parsed !== null ? (parsed as WriterMessage) : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the transcript a turn leaves behind out of the chat sidebar.
 *
 * Every turn makes the CLI write a session file into the participant profile's
 * config directory and the session index picks up whatever it finds there, so a
 * three-round debate would surface a handful of chats nobody started. Indexing
 * has to run first: archiving a row that does not exist yet changes nothing and
 * the next pass would surface the transcript anyway. A file is only ever indexed
 * once — the scan is bounded by its own cursor — so the flag then stays put.
 * Never throws: housekeeping does not fail a turn that has already been paid for.
 */
async function hideTurnSession(
  deps: CollabClaudeRuntimeDeps,
  providerSessionId: string | null,
): Promise<void> {
  if (!providerSessionId) return;

  try {
    if (deps.archiveSession) {
      await deps.archiveSession(providerSessionId);
      return;
    }
    await sessionSynchronizerService.synchronizeSessions();
    const session = sessionsDb.getSessionByProviderSessionId(providerSessionId);
    if (session) sessionsDb.updateSessionIsArchived(session.session_id, true);
  } catch (error) {
    console.error('[collab] could not archive the session left behind by a turn:', error);
  }
}

/** The engine's runtime seam, filled in with a real Claude call. */
export const collabClaudeRuntime: CollabRuntime = async ({
  prompt, profileId, cwd, signal, model, effort,
}) => {
  const deps = claudeDeps;
  if (!deps) throw new Error(RUNTIME_NOT_WIRED_ERROR);

  const chunks: string[] = [];
  const failures: string[] = [];
  const session: { id: string | null } = { id: null };

  const writer = {
    send: (data: unknown): void => {
      const message = readWriterMessage(data);
      if (!message) return;

      if (message.kind === 'text' && message.role === 'assistant' && typeof message.content === 'string') {
        chunks.push(message.content);
      } else if (message.kind === 'error' && typeof message.content === 'string') {
        // The SDK reports failures through the writer rather than by throwing,
        // so this is the only place a dead account or a bad cwd shows up.
        failures.push(message.content);
      } else if (message.kind === 'permission_request' && typeof message.requestId === 'string') {
        const { requestId } = message;
        // Deferred on purpose: the runtime may still be inside the call that
        // announced this request, and an answer that arrives before the request
        // is registered is dropped on the floor — which strands the turn on a
        // prompt no one is coming to answer.
        queueMicrotask(() => {
          deps.resolveToolApproval?.(requestId, {
            allow: false,
            message: PERMISSION_DENIED_MESSAGE,
          });
        });
      }
    },
    setSessionId: (sessionId: string): void => {
      session.id = sessionId;
    },
  };

  // The engine owns the per-turn deadline; honouring its signal is what makes
  // an abandoned turn stop costing tokens instead of just stopping being awaited.
  const onAbort = (): void => {
    if (session.id) void deps.abortSession?.(session.id);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await deps.query(
      prompt,
      {
        cwd,
        profileId,
        permissionMode: 'plan',
        sessionId: null,
        // Passed through even when unset: the SDK entry point already falls
        // back to the catalog default for a missing model and drops an effort
        // the chosen model does not accept, so a seat that picked nothing gets
        // exactly the run it got before seats could pick.
        model,
        effort,
        toolsSettings: {
          allowedTools: READ_ONLY_TOOLS,
          disallowedTools: DISALLOWED_TOOLS,
          skipPermissions: false,
        },
      },
      writer,
    );
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await hideTurnSession(deps, session.id);
  }

  if (failures.length > 0) throw new Error(failures.join(' '));

  const answer = chunks.join('\n\n').trim();
  if (!answer) throw new Error(NO_ANSWER_ERROR);
  return answer;
};
