/**
 * Live-update transport for the Review Center.
 *
 * Every review mutation (opened, state change, new comment) pushes the queue
 * entry to every connected chat WebSocket client so the Review Center updates
 * without polling. Mirrors `broadcastTaskUpdate` in the tasks module.
 */

import type { TaskReviewWithTaskRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

export type ReviewUpdateAction = 'opened' | 'updated' | 'commented' | 'closed';

export function broadcastReviewUpdate(
  review: TaskReviewWithTaskRow,
  action: ReviewUpdateAction,
): void {
  const message = JSON.stringify({ kind: 'review_update', action, review });

  connectedClients.forEach((client: RealtimeClientConnection) => {
    if (client.readyState !== WS_OPEN_STATE) {
      return;
    }
    // One client's socket throwing (e.g. mid-close) must not stop the
    // broadcast from reaching everyone else.
    try {
      client.send(message);
    } catch (error) {
      console.error('[reviews] broadcast to a client failed:', error);
    }
  });
}
