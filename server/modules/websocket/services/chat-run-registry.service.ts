import path from 'node:path';

import { activeSessionRunsDb, projectsDb, sessionRunFailuresDb, sessionsDb } from '@/modules/database/index.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import { ChatSessionWriter } from '@/modules/websocket/services/chat-session-writer.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { ActiveSessionRunRow } from '@/modules/database/index.js';
import type {
  LLMProvider,
  NormalizedMessage,
  RealtimeClientConnection,
} from '@/shared/types.js';

type ChatRunStatus = 'running' | 'completed';

/**
 * One live (or recently finished) provider run for a single app session.
 *
 * State notes — why each mutable field is essential:
 * - `providerSessionId`: the provider-native id captured mid-run. The abort
 *   handler needs it to address the provider runtime, and the DB mapping is
 *   written from it so history/resume work after the run.
 * - `status`: drives `chat_subscribed.isProcessing`, prevents double sends
 *   into the same session, and guards the synthetic-complete fallback in the
 *   chat handler (only emitted when a runtime died without completing).
 * - `lastSeq` / `events`: the per-run event log. Every live event gets a
 *   monotonically increasing `seq` and is buffered so a reconnecting client
 *   can replay exactly the events it missed via `chat.subscribe`.
 * - `lastErrorText`: the most recent error the runtime reported. Held until
 *   the terminal `complete` says whether the run actually failed, because
 *   runtimes also emit `error` for mid-run stderr that ends fine.
 */
type ChatRun = {
  appSessionId: string;
  provider: LLMProvider;
  providerSessionId: string | null;
  status: ChatRunStatus;
  lastSeq: number;
  events: NormalizedMessage[];
  writer: ChatSessionWriter;
  startedAt: number;
  completedAt: number | null;
  lastErrorText: string | null;
};

/**
 * How long a completed run stays available for replay. Covers the window
 * between a run finishing and the client refreshing history over REST (for
 * example when the browser tab was asleep while the run completed).
 */
const COMPLETED_RUN_RETENTION_MS = 5 * 60 * 1000;

/**
 * Upper bound on buffered events per run so a very long tool-heavy run cannot
 * grow memory unbounded. When exceeded, the oldest events are dropped —
 * a reconnecting client whose `lastSeq` predates the buffer falls back to a
 * REST history refresh, which is always the authoritative source.
 */
const MAX_BUFFERED_EVENTS_PER_RUN = 5000;

/**
 * Recorded for a run whose process died with no chance to say anything: a kill
 * signal it cannot catch, an OOM kill, a hardware fault. Worded apart from the
 * notice a graceful shutdown writes so a crash is never read as a restart.
 */
const INTERRUPTED_RUN_ERROR = 'The server went down while this run was in progress.';

/**
 * Active and recently-completed runs keyed by app session id.
 *
 * This map is the single in-memory source of truth for "is something running
 * for this session" — the chat websocket handler, abort path, and subscribe
 * path all consult it instead of asking each provider runtime individually.
 */
const runs = new Map<string, ChatRun>();

async function broadcastCanonicalSessionUpsert(appSessionId: string): Promise<void> {
  const row = sessionsDb.getSessionById(appSessionId);
  if (!row || row.isArchived) {
    return;
  }

  const projectPath = row.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(path.basename(projectPath ?? '') || (projectPath ?? ''), projectPath);

  const payload = JSON.stringify({
    kind: 'session_upserted',
    sessionId: row.session_id,
    providerSessionId: row.provider_session_id,
    provider: row.provider,
    session: {
      id: row.session_id,
      summary: row.custom_name || '',
      messageCount: 0,
      lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    },
    project: project
      ? {
        projectId: project.project_id,
        path: project.project_path,
        fullPath: project.project_path,
        displayName,
        isStarred: Boolean(project.isStarred),
      }
      : null,
    timestamp: new Date().toISOString(),
  });

  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
}

/**
 * Writes the run's failure to the database when its terminal `complete` says
 * the run ended badly.
 *
 * Live `error` events only ever reach an open websocket and are buffered for
 * minutes, so a failure that lands while the tab is closed used to vanish
 * entirely — the session simply appeared to stop. Persisting here means the
 * history endpoint can still say what happened, hours later.
 */
function persistFailureIfAny(run: ChatRun, message: NormalizedMessage): void {
  if (message.aborted) {
    // The user stopped it on purpose; that is not a failure to explain.
    return;
  }

  const exitCode = typeof message.exitCode === 'number' ? message.exitCode : null;
  if (exitCode === 0) {
    // A clean run supersedes recorded failures: they exist to explain why the
    // session last stopped, and it just stopped fine. Left in place they would
    // render at the tail of the transcript on every history load, long after
    // the session recovered.
    try {
      sessionRunFailuresDb.deleteBySession(run.appSessionId);
    } catch (error) {
      console.error('[ChatRunRegistry] Failed to clear stale run failures:', error);
    }
    return;
  }

  try {
    sessionRunFailuresDb.recordFailure({
      sessionId: run.appSessionId,
      provider: run.provider,
      errorMessage: run.lastErrorText || 'The run stopped without reporting a reason.',
      exitCode,
      failedAt: new Date(),
    });
  } catch (error) {
    // Never let bookkeeping break the terminal event the client is waiting on.
    console.error('[ChatRunRegistry] Failed to persist run failure:', error);
  }
}

/**
 * Drops the durable marker of a run that has ended, however it ended.
 *
 * A marker that survives its run only costs one spurious interruption row at
 * the next boot, so this must never interrupt the terminal event the client is
 * waiting on.
 */
function clearRunMarker(appSessionId: string): void {
  try {
    activeSessionRunsDb.clear(appSessionId);
  } catch (error) {
    console.error('[ChatRunRegistry] Failed to clear the marker of a finished run:', error);
  }
}

/**
 * Whether the session already has a failure recorded for the run that started
 * at `startedAt`. A shutdown with time to write its own row has already
 * explained the stop, and a second row would show one run ending twice in the
 * transcript.
 */
function hasFailureRecordedSince(sessionId: string, startedAt: string): boolean {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return false;
  }

  return sessionRunFailuresDb.listBySession(sessionId).some((failure) => {
    const failedAtMs = Date.parse(failure.failed_at);
    return Number.isFinite(failedAtMs) && failedAtMs >= startedAtMs;
  });
}

/** Markers left by the previous process, or an empty list if they cannot be read. */
function readRunMarkers(): ActiveSessionRunRow[] {
  try {
    return activeSessionRunsDb.listAll();
  } catch (error) {
    console.error('[ChatRunRegistry] Failed to read the runs a restart left behind:', error);
    return [];
  }
}

function evictRunLater(appSessionId: string): void {
  const timer = setTimeout(() => {
    const run = runs.get(appSessionId);
    if (run && run.status === 'completed') {
      runs.delete(appSessionId);
    }
  }, COMPLETED_RUN_RETENTION_MS);

  // Never keep the process alive just to evict a buffered run.
  timer.unref?.();
}

/**
 * Decorates one outbound live event for a run and records it in the event log.
 *
 * Responsibilities:
 * 1. Remap `sessionId` (and `actualSessionId` on `complete`) to the stable
 *    app session id — provider-native ids never leave the backend.
 * 2. Assign the next `seq` so clients can detect/replay gaps.
 * 3. Buffer the event for `chat.subscribe` replay.
 * 4. Flip the run to `completed` when the terminal `complete` event passes by.
 */
function decorateAndRecordEvent(run: ChatRun, message: NormalizedMessage): NormalizedMessage | null {
  // Exactly-one-complete contract: when a run is aborted the chat handler
  // emits the terminal `complete` immediately, but the killed runtime may
  // still emit its own `complete` from its exit handler moments later.
  // Whichever arrives first wins; the duplicate is dropped here.
  if (message.kind === 'complete' && run.status === 'completed') {
    return null;
  }

  run.lastSeq += 1;

  const outbound: NormalizedMessage = {
    ...message,
    sessionId: run.appSessionId,
    seq: run.lastSeq,
  };

  if (message.kind === 'error') {
    const text = typeof message.content === 'string' ? message.content : '';
    if (text.trim()) {
      run.lastErrorText = text;
    }
  }

  if (message.kind === 'complete') {
    // The provider may report its own id here; the frontend only ever knows
    // the app id, so the "actual" id is by definition the app id as well.
    outbound.actualSessionId = run.appSessionId;
    run.status = 'completed';
    run.completedAt = Date.now();
    persistFailureIfAny(run, message);
    clearRunMarker(run.appSessionId);
    evictRunLater(run.appSessionId);
  }

  run.events.push(outbound);
  if (run.events.length > MAX_BUFFERED_EVENTS_PER_RUN) {
    run.events.splice(0, run.events.length - MAX_BUFFERED_EVENTS_PER_RUN);
  }

  return outbound;
}

/**
 * Records the provider-native session id for a run and persists the
 * app-id-to-provider-id mapping so history fetches and future resumes can
 * address the provider transcript.
 *
 * Called from the gateway writer when the runtime either calls
 * `setSessionId(...)` or emits its `session_created` event — whichever
 * happens first wins; later calls with the same id are no-ops.
 */
function recordProviderSessionId(run: ChatRun, providerSessionId: string): void {
  if (!providerSessionId || run.providerSessionId === providerSessionId) {
    return;
  }

  run.providerSessionId = providerSessionId;

  try {
    sessionsDb.assignProviderSessionId(run.appSessionId, providerSessionId);
    void broadcastCanonicalSessionUpsert(run.appSessionId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ChatRunRegistry] Failed to broadcast canonical session mapping', {
        appSessionId: run.appSessionId,
        providerSessionId,
        error: message,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ChatRunRegistry] Failed to persist provider session id mapping', {
      appSessionId: run.appSessionId,
      providerSessionId,
      error: message,
    });
  }
}

/**
 * Registry of live provider runs keyed by the stable app session id.
 *
 * The registry is what makes the websocket protocol provider-independent:
 * every run gets a `ChatSessionWriter` that remaps provider-native session
 * ids to the app id, assigns `seq` numbers, and buffers events for replay —
 * regardless of which provider runtime produced them.
 */
export const chatRunRegistry = {
  /**
   * Starts tracking a run and returns it, or `null` when a run is already in
   * progress for the session (callers must reject the duplicate send).
   */
  startRun(input: {
    appSessionId: string;
    provider: LLMProvider;
    providerSessionId: string | null;
    connection: RealtimeClientConnection;
    userId: string | number | null;
  }): ChatRun | null {
    const existing = runs.get(input.appSessionId);
    if (existing && existing.status === 'running') {
      return null;
    }

    const run: ChatRun = {
      appSessionId: input.appSessionId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      status: 'running',
      lastSeq: 0,
      events: [],
      writer: null as unknown as ChatSessionWriter,
      startedAt: Date.now(),
      completedAt: null,
      lastErrorText: null,
    };

    run.writer = new ChatSessionWriter({
      connection: input.connection,
      userId: input.userId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      onProviderSessionId: (providerSessionId) => {
        recordProviderSessionId(run, providerSessionId);
      },
      decorateOutboundEvent: (message) => decorateAndRecordEvent(run, message),
    });

    runs.set(input.appSessionId, run);

    // Durable half of the registry. A run that dies with its process emits no
    // terminal event and leaves nothing behind, so this marker is the only
    // thing that can tell the next boot the session was cut off mid-run.
    try {
      activeSessionRunsDb.markStarted({
        sessionId: run.appSessionId,
        provider: run.provider,
        startedAt: new Date(run.startedAt),
      });
    } catch (error) {
      console.error('[ChatRunRegistry] Failed to mark a run as in flight:', error);
    }

    return run;
  },

  getRun(appSessionId: string): ChatRun | undefined {
    return runs.get(appSessionId);
  },

  isProcessing(appSessionId: string): boolean {
    return runs.get(appSessionId)?.status === 'running';
  },

  listRunningRuns(): Array<{
    sessionId: string;
    provider: LLMProvider;
    startedAt: number;
    lastSeq: number;
  }> {
    return Array.from(runs.values())
      .filter((run) => run.status === 'running')
      .map((run) => ({
        sessionId: run.appSessionId,
        provider: run.provider,
        startedAt: run.startedAt,
        lastSeq: run.lastSeq,
      }));
  },

  /**
   * Re-attaches a run's outbound stream to a (new) websocket connection.
   *
   * This is the generic replacement for the Claude-only writer reconnect:
   * after a page refresh the new socket subscribes and immediately starts
   * receiving the still-running stream, for every provider.
   */
  attachConnection(appSessionId: string, connection: RealtimeClientConnection): boolean {
    const run = runs.get(appSessionId);
    if (!run) {
      return false;
    }

    run.writer.updateWebSocket(connection);
    return true;
  },

  /**
   * Returns buffered events with `seq` greater than `afterSeq` for replay.
   *
   * An empty array with `run.lastSeq > afterSeq` not covered by the buffer
   * means the buffer was truncated; the client should refresh over REST.
   */
  replayEvents(appSessionId: string, afterSeq: number): NormalizedMessage[] {
    const run = runs.get(appSessionId);
    if (!run) {
      return [];
    }

    return run.events.filter((event) => typeof event.seq === 'number' && event.seq > afterSeq);
  },

  /**
   * Emits a synthetic terminal `complete` if (and only if) the run is still
   * marked running. Used when a provider runtime throws or resolves without
   * having produced its own terminal event, and by the abort path.
   */
  completeRun(appSessionId: string, opts: { exitCode: number; aborted?: boolean }): void {
    const run = runs.get(appSessionId);
    if (!run || run.status !== 'running') {
      return;
    }

    run.writer.sendComplete(opts);
  },

  /**
   * Safety-net variant of `completeRun` scoped to one specific run: a no-op
   * unless `run` is still the session's current, running run. A runtime
   * promise can resolve after its own `complete` already streamed AND a new
   * run has replaced it in the registry (a queued message sends within
   * milliseconds of the previous turn ending) — the session-keyed
   * `completeRun` would terminate that newer run.
   */
  completeRunIfCurrent(run: ChatRun, opts: { exitCode: number; aborted?: boolean }): void {
    if (runs.get(run.appSessionId) !== run || run.status !== 'running') {
      return;
    }

    run.writer.sendComplete(opts);
  },

  /**
   * Turns the runs a dead process left behind into recorded failures.
   *
   * Runs are tracked in memory, so a kill signal the process cannot catch, an
   * OOM kill or a hardware fault ends them with no terminal event and nothing
   * on record — the session simply looks abandoned. Their markers outlive the
   * process, and at boot each one is either already explained (a shutdown that
   * had time to write its own reason) or becomes a failure here.
   *
   * Runs once, before anything can serve a request: nothing can be in flight
   * while the process is still starting, so every marker left is stale and the
   * table is emptied afterwards. Never throws — a sweep that fails is not a
   * reason to refuse to boot.
   *
   * @returns how many interrupted runs were recorded.
   */
  recordRunsInterruptedByCrash(): number {
    let recorded = 0;

    for (const marker of readRunMarkers()) {
      try {
        if (hasFailureRecordedSince(marker.session_id, marker.started_at)) {
          continue;
        }

        sessionRunFailuresDb.recordFailure({
          sessionId: marker.session_id,
          provider: marker.provider,
          errorMessage: INTERRUPTED_RUN_ERROR,
        });
        recorded += 1;
      } catch (error) {
        console.error(
          `[ChatRunRegistry] Failed to record run ${marker.session_id} as interrupted:`,
          error,
        );
      }
    }

    try {
      activeSessionRunsDb.clearAll();
    } catch (error) {
      console.error('[ChatRunRegistry] Failed to clear the runs a restart left behind:', error);
    }

    return recorded;
  },

  /**
   * Test-only escape hatch: clears every tracked run.
   */
  clearAll(): void {
    runs.clear();
  },
};
