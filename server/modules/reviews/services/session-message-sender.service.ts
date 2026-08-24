/**
 * Delivers a message into an existing agent session with no browser behind it.
 *
 * The Review Center is a human surface, but the reply has to arrive where the
 * agent is: this starts a real run on the session through the same registry
 * and writer the chat WebSocket uses, so the turn streams to every open client
 * and lands in the transcript exactly like a message typed in the composer.
 *
 * Deliberately narrower than `chat.send`:
 * - a session already mid-run is refused rather than queued, and the caller
 *   reports it as "not routed" (the comment is still in the Review Center);
 * - no cross-provider primer is consumed — that text belongs to the first
 *   composer message of a handed-over session and must not be spent here;
 * - the account is the session's own `profile_id`, already policy-checked when
 *   the session was created, so no account is chosen at this point.
 */

import { stat } from 'node:fs/promises';

import type { SessionRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';
import type { LLMProvider, RealtimeClientConnection } from '@/shared/types.js';

import type { SessionMessageSender } from './review-comment-delivery.service.js';

type ProviderSpawnFn = (
  command: string,
  options: Record<string, unknown>,
  writer: unknown,
) => Promise<unknown>;

export type SessionMessageSenderDeps = {
  spawnFns: Record<string, ProviderSpawnFn>;
};

/**
 * Stand-in for the socket a browser would own.
 *
 * A run needs one connection to write to; with no originating client, the
 * writer's output is fanned out to every open client so whoever has the
 * session on screen sees the turn arrive.
 */
const fanOutConnection: RealtimeClientConnection = {
  readyState: WS_OPEN_STATE,
  send(data: string): void {
    connectedClients.forEach((client: RealtimeClientConnection) => {
      if (client.readyState !== WS_OPEN_STATE) {
        return;
      }
      try {
        client.send(data);
      } catch (error) {
        console.error('[reviews] fan-out of a routed turn failed for a client:', error);
      }
    });
  },
};

async function isExistingDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Builds the production sender from the provider runtimes the server already
 * wires into the chat WebSocket.
 */
export function createSessionMessageSender(deps: SessionMessageSenderDeps): SessionMessageSender {
  return async function sendSessionMessage({
    session,
    text,
  }: {
    session: SessionRow;
    text: string;
  }): Promise<boolean> {
    const spawnFn = deps.spawnFns[session.provider];
    if (!spawnFn) {
      console.warn(`[reviews] no runtime for provider "${session.provider}" — comment not routed`);
      return false;
    }

    // A session pinned to a worktree only runs inside it; once the directory is
    // gone the send is refused instead of running somewhere else. Checked
    // before the run is claimed so an early return cannot strand the session
    // in "processing".
    if (session.worktree_path && !(await isExistingDirectory(session.worktree_path))) {
      console.warn(
        `[reviews] worktree "${session.worktree_path}" is gone — comment not routed to ${session.session_id}`,
      );
      return false;
    }

    const run = chatRunRegistry.startRun({
      appSessionId: session.session_id,
      // The column is a plain string; the runtime lookup above already proved
      // this provider has a registered spawn function.
      provider: session.provider as LLMProvider,
      providerSessionId: session.provider_session_id,
      connection: fanOutConnection,
      userId: null,
    });
    if (!run) {
      return false;
    }

    const options: Record<string, unknown> = {
      sessionId: session.provider_session_id ?? undefined,
      resume: Boolean(session.provider_session_id),
      cwd: session.worktree_path ?? session.project_path ?? undefined,
      projectPath: session.project_path ?? undefined,
      profileId: session.profile_id,
      cavemanMode: session.caveman_mode ?? null,
    };

    // The turn is not awaited: an agent addressing a review comment can run for
    // minutes and the HTTP response must not hang on it. Completion is still
    // reconciled — the registry is told the run ended whatever happens, so no
    // session is left stuck in "processing".
    void spawnFn(text, options, run.writer)
      .catch((error: unknown) => {
        console.error(
          `[reviews] runtime "${session.provider}" failed on a routed comment:`,
          error,
        );
      })
      .finally(() => {
        chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
      });

    return true;
  };
}
