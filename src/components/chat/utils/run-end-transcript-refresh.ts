/**
 * Decides whether the viewed session's transcript must be refetched after its
 * running indicator went away.
 *
 * A run can end while its terminal `complete` frame never reaches this client
 * (socket died half-open, page reloaded, server restarted). The only remaining
 * signal is the running-sessions poll pruning the session from the processing
 * map — without a refetch, the transcript stays frozen at the last received
 * frame and the persisted run-failure row (or the final answer) never appears.
 * When the `complete` frame did arrive, the realtime handler already refreshed
 * the transcript, so the duplicate fetch is skipped.
 */

/** How recently a live `complete` counts as "this client saw the run end". */
const COMPLETE_FRAME_FRESHNESS_MS = 5000;

export type ProcessingTransition = {
  sessionId: string | null;
  wasProcessing: boolean;
};

export function shouldRefreshTranscriptAfterRunEnd(input: {
  previous: ProcessingTransition;
  sessionId: string | null;
  isProcessing: boolean;
  completeReceivedAt: number | undefined;
  now: number;
}): boolean {
  const { previous, sessionId, isProcessing, completeReceivedAt, now } = input;

  if (!sessionId || previous.sessionId !== sessionId) {
    // Session switch: the indicator change reflects a different conversation,
    // and opening a session already fetches its transcript.
    return false;
  }

  if (!previous.wasProcessing || isProcessing) {
    return false;
  }

  return now - (completeReceivedAt ?? 0) >= COMPLETE_FRAME_FRESHNESS_MS;
}
