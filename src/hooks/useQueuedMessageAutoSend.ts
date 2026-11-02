import { useEffect, useRef } from 'react';

import { readQueuedMessages, writeQueuedMessages } from '../components/chat/utils/chatStorage';

import type { MarkSessionProcessing, SessionActivityMap } from './useSessionProtection';

interface UseQueuedMessageAutoSendArgs {
  processingSessions: SessionActivityMap;
  /**
   * The session currently open in the chat view. Its queued draft is owned by
   * the composer (which also handles image attachments and slash commands),
   * so this hook never touches it.
   */
  activeSessionId: string | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  markSessionProcessing: MarkSessionProcessing;
}

/**
 * Dispatches queued messages for sessions the user is NOT currently viewing.
 *
 * The composer persists each session's queue (text + send options snapshotted
 * at queue time, oldest first) under `queued_message_<sessionId>`. When a
 * session's run leaves the processing map — its previous response completed —
 * this hook sends the HEAD of that queue immediately instead of waiting for
 * the user to open the session again. Only one message goes out per
 * completion so the queue keeps its turn-by-turn order: the rest stay stored
 * and the next completion sends the next one. Writing the shortened queue
 * back before sending is the claim that keeps the composer's own flush from
 * double-sending.
 */
export function useQueuedMessageAutoSend({
  processingSessions,
  activeSessionId,
  ws,
  sendMessage,
  markSessionProcessing,
}: UseQueuedMessageAutoSendArgs) {
  const prevProcessingRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const prev = prevProcessingRef.current;
    const current = new Set(processingSessions.keys());
    prevProcessingRef.current = current;

    for (const sessionId of prev) {
      if (current.has(sessionId) || sessionId === activeSessionId) {
        continue;
      }

      const [queued, ...rest] = readQueuedMessages(sessionId);
      if (!queued) {
        continue;
      }

      // A closed socket would drop the send silently; keep the draft so the
      // composer (or a later completion) can retry once we're connected.
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      writeQueuedMessages(sessionId, rest);
      sendMessage({
        type: 'chat.send',
        sessionId,
        content: queued.content,
        options: { ...(queued.options ?? {}), images: [] },
      });
      markSessionProcessing(sessionId, { statusText: null, canInterrupt: true });
    }
  }, [processingSessions, activeSessionId, ws, sendMessage, markSessionProcessing]);
}
