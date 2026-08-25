import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { WebSocket } from 'ws';

import { sessionsDb } from '@/modules/database/index.js';
import {
  OrgPolicyError,
  orgPolicyService,
  type OrgPolicyService,
} from '@/modules/orgs/index.js';
import {
  consumePendingPrimer,
  handoffService,
  profilesService,
  type HandoffResult,
} from '@/modules/profiles/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import { getGlobalImageAssetsDir, normalizeImageDescriptors } from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  LLMProvider,
} from '@/shared/types.js';
import { parseIncomingJsonObject } from '@/shared/utils.js';

/**
 * Trust boundary for client-supplied image attachments: chat.send options come
 * straight from the browser, and the provider runtimes read the referenced
 * files off disk (Claude base64-encodes them into the prompt). Only images
 * that live directly inside the global upload store (`~/.cloudcli/assets`,
 * where POST /api/assets/images puts them) are allowed through — anything
 * else (absolute paths elsewhere, traversal, subdirectories) is dropped.
 *
 * Exported for tests; `assetsRootOverride` exists only for them.
 */
export function filterImagesToUploadStore(images: unknown, assetsRootOverride?: string): AnyRecord[] {
  const assetsRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());

  return normalizeImageDescriptors(images).filter((descriptor) => {
    // Relative paths are anchored in the store; absolute ones must already be in it.
    const resolved = path.resolve(assetsRoot, descriptor.path);
    const relative = path.relative(assetsRoot, resolved);
    const isDirectChild =
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep) &&
      !relative.includes('/');

    if (!isDirectChild) {
      console.warn(`[Chat] Dropping image outside the upload store: ${descriptor.path}`);
    }
    return isDirectChild;
  });
}

/**
 * Splits the handed-over conversation from the user's own words on the first
 * turn of a seeded session, so the model reads the primer as background rather
 * than as part of the request it has to answer.
 */
const PRIMER_SEPARATOR = '\n\n---\n\n';

/**
 * One provider runtime entry point. All five runtimes share this signature,
 * which lets the chat handler dispatch through a provider-keyed map instead
 * of provider-specific branches.
 */
type ProviderSpawnFn = (
  command: string,
  options: AnyRecord,
  writer: unknown
) => Promise<unknown>;

type ChatWebSocketDependencies = {
  /** Provider runtimes keyed by provider id. */
  spawnFns: Record<LLMProvider, ProviderSpawnFn>;
  /**
   * Abort functions keyed by provider id. They are addressed with the
   * provider-native session id (that is how runtimes key their process maps).
   * The Claude abort is async; the rest are sync — both shapes are accepted.
   */
  abortFns: Record<LLMProvider, (providerSessionId: string) => boolean | Promise<boolean>>;
  resolveToolApproval: (
    requestId: string,
    payload: {
      allow: boolean;
      updatedInput?: unknown;
      message?: string;
      rememberEntry?: unknown;
    }
  ) => void;
  /** Claude-only today: pending tool approvals included in `chat_subscribed`. */
  getPendingApprovalsForSession: (providerSessionId: string) => unknown[];
  /**
   * Org policy engine consulted before every spawn. Defaults to the real
   * service so the entrypoint keeps its current wiring; tests inject doubles.
   */
  orgPolicy?: OrgPolicyService;
};

/** Outcome of the pre-spawn policy check; `profileId` null means "runtime default". */
type SpawnProfileDecision =
  | { allowed: true; profileId: string | null }
  | { allowed: false; code: string; reason: string };

/**
 * Decides which account a send may run on, or refuses it.
 *
 * An explicitly chosen profile (the session's own, or the one the composer
 * sent) only has to pass the org allow-list — quota never overrides a
 * deliberate choice. With no choice the org resolver picks one, which is what
 * makes automatic quota fallback happen. The one case that keeps the upstream
 * behavior is an installation with no accounts and no policies at all: there is
 * nothing to enforce, so the runtime stays on its own config directory.
 *
 * Anything the policy engine cannot decide is a refusal, never a silent pass.
 */
async function decideSpawnProfile(
  policy: OrgPolicyService,
  projectPath: string | null,
  requestedProfileId: string | null,
  provider: LLMProvider,
  sessionId: string
): Promise<SpawnProfileDecision> {
  try {
    if (requestedProfileId) {
      policy.assertProfileAllowed(projectPath, requestedProfileId);
      return { allowed: true, profileId: requestedProfileId };
    }

    const allowed = policy.listAllowedProfiles(projectPath, { provider });
    if (allowed.profiles.length === 0 && !allowed.policyManaged) {
      return { allowed: true, profileId: null };
    }

    const selection = await policy.resolveProfileForSpawn(projectPath, { provider, sessionId });
    if (selection.fallback) {
      // The account is not the one the org lists first; it must be visible in
      // the logs (it is also written to the fallback audit by the resolver).
      console.warn('[Chat] Spawning on a fallback account', {
        sessionId,
        profileId: selection.profileId,
        reason: selection.fallback.reason,
        primaryUsagePct: selection.fallback.primaryUsagePct,
      });
    }
    return { allowed: true, profileId: selection.profileId };
  } catch (error) {
    if (error instanceof OrgPolicyError) {
      return { allowed: false, code: error.code, reason: error.reason };
    }
    throw error;
  }
}

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  const user = request?.user;
  if (!user) {
    return null;
  }

  if (typeof user.id === 'string' || typeof user.id === 'number') {
    return user.id;
  }

  if (typeof user.userId === 'string' || typeof user.userId === 'number') {
    return user.userId;
  }

  return null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Reports a protocol-level failure to the requesting client.
 *
 * Protocol errors deliberately use their own `kind` (instead of the provider
 * `error` message kind) so the frontend can distinguish "your request was
 * invalid" from "the model run produced an error" without inspecting text.
 */
function sendProtocolError(
  ws: WebSocket,
  code: string,
  error: string,
  sessionId?: string
): void {
  sendJson(ws, {
    kind: 'protocol_error',
    code,
    error,
    sessionId: sessionId ?? null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Announces a deferred account/provider switch that just landed.
 *
 * The socket that requested the switch may be long gone by the time it is
 * applied (that is the whole point of deferring it past the running turn),
 * so this is a fire-and-out broadcast rather than a reply to one connection —
 * same audience as `session_upserted`: every currently connected chat
 * client, not only ones subscribed to `sourceSessionId`. Each client's job on
 * receipt is to refresh its session/project list so a newly seeded session
 * appears in the sidebar; it must never yank the user's current view, since
 * the switch can land while they are reading something unrelated.
 *
 * `type` (not `kind`) deliberately mirrors the existing TaskMaster broadcast
 * convention on this same socket, keeping it a distinct sub-protocol from the
 * `kind`-based provider/gateway events.
 */
function broadcastSessionHandoff(sourceSessionId: string, result: HandoffResult): void {
  const provider = profilesService.getProfile(result.profileId).provider;
  const payload = JSON.stringify({
    type: 'session.handoff',
    sessionId: sourceSessionId,
    status: result.status,
    // Same as `sessionId` except on `'seeded'`, the same-provider transplant's
    // own filesystem-level degradation to a brand-new session id.
    targetSessionId: result.sessionId,
    provider,
    profileId: result.profileId,
  });

  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
}

/**
 * Whether `directoryPath` is still a directory on disk.
 *
 * Any failure (missing path, permission denied, path replaced by a file)
 * counts as "not usable as a working directory" — the caller only wants to
 * know whether it is safe to spawn a runtime there.
 */
async function isExistingDirectory(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

function readRequiredSessionId(data: AnyRecord): string | null {
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return sessionId.length > 0 ? sessionId : null;
}

/**
 * Handles `chat.send`: resolves the session row (provider, project path, and
 * provider-native id all come from the database — never from the client),
 * registers the run, and dispatches to the provider runtime.
 */
async function handleChatSend(
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.send requires a sessionId.');
    return;
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    sendProtocolError(
      ws,
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`,
      sessionId
    );
    return;
  }

  const provider = session.provider as LLMProvider;
  const spawnFn = dependencies.spawnFns[provider];
  if (!spawnFn) {
    sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }

  // A session pinned to a worktree only runs inside that worktree. Once the
  // directory is gone (`git worktree remove`, manual delete), spawning would
  // either fail deep inside the runtime or silently run somewhere else, so the
  // send is rejected and the user decides what to do next — no worktree is
  // recreated here. The check runs before the run is registered: nothing has
  // been claimed in the registry yet, so an early return cannot leave the
  // session stuck in "processing". Sessions without a worktree skip the stat
  // entirely — the normal path must not pay a syscall per message.
  if (session.worktree_path && !(await isExistingDirectory(session.worktree_path))) {
    sendProtocolError(
      ws,
      'WORKTREE_MISSING',
      `The worktree "${session.worktree_path}" for this session no longer exists on disk.`,
      sessionId
    );
    return;
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;

  // The owning account profile is a property of the session, so it is read from
  // the session row rather than trusted from the per-message options; the
  // composer's value only applies to a session that never picked one.
  const requestedProfileId = session.profile_id
    ?? (typeof clientOptions.profileId === 'string' ? clientOptions.profileId : null);

  // Policy is evaluated against the session's own project path: a
  // client-supplied one could name a project whose org allows more accounts.
  // This runs before the run is registered and before the primer is consumed,
  // so a refusal leaves neither a session stuck in "processing" nor a handed
  // over conversation cleared without a model ever reading it.
  const profileDecision = await decideSpawnProfile(
    dependencies.orgPolicy ?? orgPolicyService,
    session.project_path ?? null,
    requestedProfileId,
    provider,
    sessionId
  );
  if (!profileDecision.allowed) {
    sendProtocolError(ws, profileDecision.code, profileDecision.reason, sessionId);
    return;
  }

  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id,
    connection: ws,
    userId,
  });

  if (!run) {
    sendProtocolError(
      ws,
      'RUN_IN_PROGRESS',
      `Session "${sessionId}" already has a run in progress.`,
      sessionId
    );
    return;
  }

  const userPrompt = typeof data.content === 'string' ? data.content : '';

  // A session born from a cross-provider handoff carries the earlier
  // conversation as a text primer that the target model has never seen; this is
  // the only place it reaches one. It is consumed here, after the run has been
  // registered and past every early return (unknown session, unavailable
  // provider, missing worktree, refused account, run already in progress):
  // consuming it on a branch that bails out would clear the pointer without a
  // model ever reading it, and it would be lost for good. Everything below this point
  // dispatches. Consuming clears the pointer, so the second turn onward sends
  // the user's prompt untouched.
  const primer = consumePendingPrimer(session);
  const command = primer === null ? userPrompt : `${primer}${PRIMER_SEPARATOR}${userPrompt}`;

  // The provider runtimes receive the provider-native session id (that is the
  // id their CLI/SDK understands for resume). Brand-new sessions have no
  // provider id yet, so the runtime starts fresh and announces one, which the
  // gateway writer captures and maps back to the app session id.
  const runtimeOptions: AnyRecord = {
    ...clientOptions,
    // Image attachments are re-validated server-side: only files inside the
    // global upload store may reach the provider runtimes' file reads.
    images: filterImagesToUploadStore(clientOptions.images),
    sessionId: session.provider_session_id ?? undefined,
    resume: Boolean(session.provider_session_id),
    // The session's worktree outranks the client's `cwd`: the browser sends
    // the path of the selected project (the parent repo, since worktree
    // sessions are listed under it), and no composer option may drag an
    // isolated session out of the tree it was started in.
    cwd: session.worktree_path ?? clientOptions.cwd ?? session.project_path ?? undefined,
    projectPath: session.project_path ?? clientOptions.projectPath,
    // Settled above by the org policy: either the requested account (allowed),
    // the one the org picked, or NULL to keep the provider CLI on its default
    // config dir (upstream behavior).
    profileId: profileDecision.profileId,
    // Same reasoning as profileId: the override belongs to the session, so it
    // comes from the row. NULL means the session never chose one and follows
    // whatever its profile is set to.
    cavemanMode: session.caveman_mode ?? null,
  };

  // From here on the session is executing a turn, so an account switch asked
  // for meanwhile must be queued rather than applied on top of a live stream
  // (a cross-provider switch even creates a new session). Marking happens only
  // after `startRun` returned a live run: a send rejected at RUN_IN_PROGRESS
  // never reaches the completion path below, so marking it there would leave
  // the flag set forever and queue every later switch on that session. Nothing
  // between this line and the `try` can throw, so the flag is always paired
  // with the `finally` that clears it.
  handoffService.markSessionRunning(sessionId);

  try {
    await spawnFn(command, runtimeOptions, run.writer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Chat] Provider runtime "${provider}" failed`, { sessionId, error: message });
  } finally {
    // Safety net: a runtime that crashed (or resolved) without emitting its
    // terminal `complete` would otherwise leave the session stuck in
    // "processing" forever on every connected client. Scoped to THIS run —
    // a queued message can start the session's next run before this promise
    // settles, and the session-keyed completeRun would kill that new run.
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });

    // The turn is over, so a switch deferred during it can be applied now.
    // Idle strictly before the drain: while the session still counts as
    // running, the switch the drain picks up would simply be queued again.
    handoffService.markSessionIdle(sessionId);

    // Applying a deferred switch creates sessions and touches the filesystem,
    // so it is deliberately not awaited — the completion path must neither
    // wait on it nor be rejected into by it. The result is kept in hand at
    // this call site because the handoff outcome belongs here; a failure is
    // logged and dropped, and the operator can request the switch again.
    void handoffService
      .drainPendingSwitch(sessionId)
      .then((result) => {
        if (result) {
          console.log('[Chat] Applied a deferred account switch', {
            sessionId,
            status: result.status,
            profileId: result.profileId,
            continuesAs: result.sessionId,
          });
          broadcastSessionHandoff(sessionId, result);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Chat] Deferred account switch failed to apply', { sessionId, error: message });
      });
  }
}

/**
 * Handles `chat.abort`: cancels the run for one app session and emits the
 * terminal `complete` on its behalf (runtimes skip their own complete for
 * aborted runs, and the registry drops any duplicate).
 */
async function handleChatAbort(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
    return;
  }

  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    sendProtocolError(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    return;
  }

  const abortFn = dependencies.abortFns[run.provider];
  let success = false;
  if (abortFn && run.providerSessionId) {
    success = Boolean(await abortFn(run.providerSessionId));
  }

  chatRunRegistry.completeRun(sessionId, {
    exitCode: success ? 0 : 1,
    aborted: true,
  });
}

/**
 * Handles `chat.subscribe`: for each requested session, reports whether a run
 * is processing, re-attaches the live stream to this socket, replays missed
 * events (seq > lastSeq), and includes pending permission requests.
 *
 * This single message replaces the old `check-session-status`,
 * `get-pending-permissions`, and Claude-only writer reconnect flows.
 */
function handleChatSubscribe(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): void {
  const targets = Array.isArray(data.sessions) ? data.sessions : [];

  for (const target of targets) {
    if (!target || typeof target !== 'object') {
      continue;
    }

    const sessionId = typeof (target as AnyRecord).sessionId === 'string'
      ? ((target as AnyRecord).sessionId as string).trim()
      : '';
    if (!sessionId) {
      continue;
    }

    const lastSeqRaw = (target as AnyRecord).lastSeq;
    const lastSeq = typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
      ? Math.max(0, Math.floor(lastSeqRaw))
      : 0;

    const run = chatRunRegistry.getRun(sessionId);
    const isProcessing = chatRunRegistry.isProcessing(sessionId);

    // Future live events for this run should land on the socket that asked —
    // this is what makes mid-stream page refreshes work for all providers.
    if (isProcessing) {
      chatRunRegistry.attachConnection(sessionId, ws);
    }

    // Pending approvals are tracked under the provider-native id inside the
    // Claude runtime; remap their sessionId so the client only sees app ids.
    const pendingPermissions = (run?.providerSessionId
      ? dependencies.getPendingApprovalsForSession(run.providerSessionId)
      : []
    ).map((approval) =>
      approval && typeof approval === 'object'
        ? { ...(approval as AnyRecord), sessionId }
        : approval,
    );

    sendJson(ws, {
      kind: 'chat_subscribed',
      sessionId,
      isProcessing,
      lastSeq: run?.lastSeq ?? 0,
      pendingPermissions,
      timestamp: new Date().toISOString(),
    });

    // Replay only for RUNNING runs, strictly after the ack. Completed runs
    // are fully persisted to the provider transcript and served over REST —
    // replaying them (e.g. after a page reload where the client's lastSeq is
    // 0) would duplicate messages the history fetch already returned.
    if (isProcessing) {
      for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq)) {
        sendJson(ws, event);
      }
    }
  }
}

/**
 * Handles `chat.permission-response`: forwards a tool-approval decision to the
 * pending approval resolver (Claude is the only provider with interactive
 * approvals today, but the message is intentionally provider-neutral).
 */
function handlePermissionResponse(data: AnyRecord, dependencies: ChatWebSocketDependencies): void {
  if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
    return;
  }

  dependencies.resolveToolApproval(data.requestId, {
    allow: Boolean(data.allow),
    updatedInput: data.updatedInput,
    message: typeof data.message === 'string' ? data.message : undefined,
    rememberEntry: data.rememberEntry,
  });
}

/**
 * Handles `chat.ping`: a lightweight liveness probe the client sends after
 * waking from background/sleep to tell a socket that still reports OPEN
 * apart from a truly half-open one (TCP still "connected" from the OS's
 * view, but the peer is gone). Carries no payload of its own.
 */
function handleChatPing(ws: WebSocket): void {
  sendJson(ws, { kind: 'chat_pong', timestamp: new Date().toISOString() });
}

/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 *
 * Inbound protocol (client to server):
 * - `chat.send`                { sessionId, content, options? }
 * - `chat.abort`               { sessionId }
 * - `chat.subscribe`           { sessions: [{ sessionId, lastSeq? }] }
 * - `chat.permission-response` { requestId, allow, updatedInput?, message?, rememberEntry? }
 * - `chat.ping`                {}
 *
 * Outbound protocol (server to client): every frame is `kind`-based — either
 * a provider `NormalizedMessage` (with `seq`) or a gateway event
 * (`chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`, `chat_pong`).
 */
export function handleChatConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  dependencies: ChatWebSocketDependencies
): void {
  console.log('[INFO] Chat WebSocket connected');
  connectedClients.add(ws);

  const userId = readRequestUserId(request);

  ws.on('message', async (rawMessage) => {
    try {
      const parsed = parseIncomingJsonObject(rawMessage);
      if (!parsed) {
        throw new Error('Invalid websocket payload');
      }

      const data = parsed as AnyRecord;
      const messageType = typeof data.type === 'string' ? data.type : '';

      switch (messageType) {
        case 'chat.send':
          await handleChatSend(ws, userId, data, dependencies);
          return;
        case 'chat.abort':
          await handleChatAbort(ws, data, dependencies);
          return;
        case 'chat.subscribe':
          handleChatSubscribe(ws, data, dependencies);
          return;
        case 'chat.permission-response':
          handlePermissionResponse(data, dependencies);
          return;
        case 'chat.ping':
          handleChatPing(ws);
          return;
        default:
          sendProtocolError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${messageType}".`);
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Chat WebSocket error:', message);
      sendProtocolError(ws, 'INTERNAL_ERROR', message);
    }
  });

  ws.on('close', () => {
    console.log('[INFO] Chat client disconnected');
    connectedClients.delete(ws);
  });
}
