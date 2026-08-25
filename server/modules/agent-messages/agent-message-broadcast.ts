/**
 * Live-update transport for handoff inbox changes.
 *
 * Every state change pushes the full message row to every connected chat
 * WebSocket client, so a future inbox/team view can follow a handoff without
 * polling. Mirrors `broadcastTaskUpdate` in the tasks module.
 *
 * `action` is `created` for a new message and `updated` for every state
 * change; which change it was is readable from `message.state`, so clients get
 * the whole current row rather than a diff they would have to replay.
 */

import type { AgentMessageRow } from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

export type AgentMessageUpdateAction = 'created' | 'updated';

export function broadcastAgentMessageUpdate(
  message: AgentMessageRow,
  action: AgentMessageUpdateAction,
): void {
  const frame = JSON.stringify({ kind: 'agent_message_update', action, message });

  connectedClients.forEach((client: RealtimeClientConnection) => {
    if (client.readyState !== WS_OPEN_STATE) {
      return;
    }
    // One client's socket throwing (e.g. mid-close) must not stop the
    // broadcast from reaching everyone else.
    try {
      client.send(frame);
    } catch (error) {
      console.error('[agent-messages] broadcast to a client failed:', error);
    }
  });
}
