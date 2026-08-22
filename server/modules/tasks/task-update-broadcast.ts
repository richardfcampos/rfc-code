/**
 * Live-update transport for task board mutations.
 *
 * Every task mutation (`created`/`updated`/`deleted`) pushes the full task row
 * to every connected chat WebSocket client so `useTaskBoard` can update the
 * board without polling. Mirrors `broadcastProfileUsage` in
 * `profile-usage-broadcast.ts`.
 */

import type { TaskRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

export type TaskUpdateAction = 'created' | 'updated' | 'deleted';

export function broadcastTaskUpdate(task: TaskRow, action: TaskUpdateAction): void {
  const message = JSON.stringify({ kind: 'task_update', action, task });

  connectedClients.forEach((client: RealtimeClientConnection) => {
    if (client.readyState !== WS_OPEN_STATE) {
      return;
    }
    // One client's socket throwing (e.g. mid-close) must not stop the
    // broadcast from reaching everyone else.
    try {
      client.send(message);
    } catch (error) {
      console.error('[tasks] broadcast to a client failed:', error);
    }
  });
}
