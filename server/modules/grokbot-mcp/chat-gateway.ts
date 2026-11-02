/**
 * In-process chat for the Grokbot MCP: starts, watches and stops turns on app
 * sessions without a browser, through the same run registry and writer the
 * chat WebSocket uses. A turn sent here streams to every open client and lands
 * in the transcript exactly like one typed in the composer.
 */

import { stat } from 'node:fs/promises';

import type { SessionRow } from '@/modules/database/index.js';
import { orgPolicyService, type OrgPolicyService } from '@/modules/orgs/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';

import { createGatewayConnection } from './chat-gateway-connection.js';
import { decideGatewayProfile, gatewayError } from './chat-gateway-profile.js';
import { defaultTurnEffects, type TurnEffects } from './chat-gateway-turn-effects.js';
import { waitForRunCompletion } from './chat-gateway-wait.js';
import type { ChatGateway, ChatSendInput, ChatSendResult, JsonObject } from './grokbot-mcp.types.js';

type ChatRunRegistry = typeof chatRunRegistry;

export type ChatGatewayDeps = {
  spawnFns: Record<string, (command: string, options: Record<string, unknown>, writer: unknown) => Promise<unknown>>;
  abortFns: Record<string, (providerSessionId: string) => boolean | Promise<boolean>>;
  resolveToolApproval(requestId: string, decision: { allow: boolean; updatedInput?: unknown; message?: string }): void;
  getPendingApprovalsForSession(providerSessionId: string): unknown[];
  /** Normally `sessionsDb.getSessionById`, injected by the composition root. */
  getSession(sessionId: string): SessionRow | null | undefined;
  policy?: OrgPolicyService;
  registry?: ChatRunRegistry;
  isDirectory?(path: string): Promise<boolean>;
  /** Title, primer and deferred-switch bookkeeping around a turn; tests swap it. */
  turnEffects?: TurnEffects;
};

const DEFAULT_WAIT_MS = 120_000;
const MAX_WAIT_MS = 600_000;

async function isExistingDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

function clampWait(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_WAIT_MS;
  return Math.min(Math.floor(timeoutMs), MAX_WAIT_MS);
}

export function createChatGateway(deps: ChatGatewayDeps): ChatGateway {
  const registry = deps.registry ?? chatRunRegistry;
  const policy = deps.policy ?? orgPolicyService;
  const isDirectory = deps.isDirectory ?? isExistingDirectory;
  const effects = deps.turnEffects ?? defaultTurnEffects;

  function requireSession(sessionId: string): SessionRow {
    const session = deps.getSession(sessionId);
    if (!session) throw gatewayError(404, 'SESSION_NOT_FOUND', `Session "${sessionId}" was not found.`);
    return session;
  }

  async function send(input: ChatSendInput): Promise<ChatSendResult> {
    const { sessionId } = input;
    const session = requireSession(sessionId);
    // The column is a plain string; the spawn lookup proves the provider is real.
    const provider = session.provider as LLMProvider;
    const spawnFn = deps.spawnFns[provider];
    if (!spawnFn) throw gatewayError(400, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`);

    // Checked before the run is claimed so a refusal cannot strand the session
    // in "processing"; a worktree session never runs outside its tree.
    if (session.worktree_path && !(await isDirectory(session.worktree_path))) {
      throw gatewayError(409, 'WORKTREE_MISSING', `The worktree "${session.worktree_path}" no longer exists on disk.`);
    }

    // The account belongs to the session, so only its own profile is requested.
    const profileId = await decideGatewayProfile(
      policy, session.project_path ?? null, session.profile_id ?? null, provider, sessionId,
    );

    const collected: JsonObject[] = [];
    let onFrame: ((frame: JsonObject) => void) | null = null;
    const connection = createGatewayConnection(input.wait ? (frame) => {
      collected.push(frame);
      onFrame?.(frame);
    } : null);

    const run = registry.startRun({
      appSessionId: sessionId,
      provider,
      providerSessionId: session.provider_session_id,
      connection,
      // The key owner is who gets the "turn finished" notification.
      userId: input.userId ?? null,
    });
    if (!run) throw gatewayError(409, 'RUN_IN_PROGRESS', `Session "${sessionId}" already has a run in progress.`);

    const options: Record<string, unknown> = {
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(input.toolsSettings ? { toolsSettings: input.toolsSettings } : {}),
      // The chat socket re-validates images against the upload store, but that
      // filter is not part of the websocket module's public surface; here the
      // caller is an API-key holder with shell access anyway, so descriptors
      // are only shape-checked and the caller is responsible for their paths.
      ...(Array.isArray(input.images) ? { images: input.images } : {}),
      sessionId: session.provider_session_id ?? undefined,
      resume: Boolean(session.provider_session_id),
      cwd: session.worktree_path ?? session.project_path ?? undefined,
      projectPath: session.project_path ?? undefined,
      profileId,
      cavemanMode: session.caveman_mode ?? null,
    };

    let turn: Promise<unknown>;
    try {
      turn = spawnFn(effects.begin(session, input.content, profileId), options, run.writer);
    } catch (error) {
      // The run is already claimed; release it or the session stays "processing".
      registry.completeRunIfCurrent(run, { exitCode: 1 });
      effects.end(sessionId);
      const reason = error instanceof Error ? error.message : String(error);
      throw gatewayError(500, 'TURN_START_FAILED', `Could not start the turn: ${reason}`);
    }

    // Not awaited: a turn can run for minutes. The registry is told the run
    // ended whatever happens, so no session is left stuck in "processing".
    void turn
      .catch((error: unknown) => {
        console.error(`[grokbot-mcp] runtime "${provider}" failed on a bot turn:`, error);
      })
      .finally(() => {
        registry.completeRunIfCurrent(run, { exitCode: 1 });
        effects.end(sessionId);
      });

    const started: ChatSendResult = { sessionId, provider, started: true };
    if (!input.wait) return started;

    const outcome = await waitForRunCompletion({
      run, collected, timeoutMs: clampWait(input.timeoutMs),
      subscribe: (listener) => { onFrame = listener; },
    });
    return { ...started, ...outcome };
  }

  function pendingApprovals(sessionId: string): JsonObject[] {
    // Approvals are keyed by the provider-native id; clients only ever see app ids.
    const providerId = registry.getRun(sessionId)?.providerSessionId ?? requireSession(sessionId).provider_session_id;
    if (!providerId) return [];
    return deps.getPendingApprovalsForSession(providerId)
      .filter((approval): approval is JsonObject => Boolean(approval) && typeof approval === 'object')
      .map((approval) => ({ ...approval, sessionId }));
  }

  async function abort(sessionId: string): Promise<{ sessionId: string; aborted: boolean }> {
    const run = registry.getRun(sessionId);
    if (!run || run.status !== 'running') {
      throw gatewayError(409, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`);
    }
    const abortFn = deps.abortFns[run.provider];
    let ok = false;
    if (abortFn && run.providerSessionId) ok = Boolean(await abortFn(run.providerSessionId));
    // Runtimes skip their own `complete` on abort; the registry drops a late duplicate.
    registry.completeRun(sessionId, { exitCode: ok ? 0 : 1, aborted: true });
    return { sessionId, aborted: ok };
  }

  return {
    send,
    abort,
    events: (sessionId, afterSeq) => registry.replayEvents(sessionId, afterSeq) as unknown as JsonObject[],
    status(sessionId) {
      const run = registry.getRun(sessionId);
      return {
        sessionId,
        isProcessing: registry.isProcessing(sessionId),
        lastSeq: run?.lastSeq ?? 0,
        provider: run?.provider ?? deps.getSession(sessionId)?.provider ?? null,
      };
    },
    pendingApprovals,
    approveTool({ requestId, allow, updatedInput, message, sessionId }) {
      // The runtime resolver is silent about unknown ids; with a session to
      // check against, a stale or mistyped id is reported instead of "resolved".
      if (sessionId !== undefined && !pendingApprovals(sessionId).some((approval) => approval.requestId === requestId)) {
        return { requestId, resolved: false, reason: 'UNKNOWN_REQUEST' };
      }
      deps.resolveToolApproval(requestId, { allow, updatedInput, message });
      return { requestId, resolved: true };
    },
  };
}
