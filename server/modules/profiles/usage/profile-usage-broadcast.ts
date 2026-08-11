/**
 * Late-result transport for `profileUsageService.getAllUsage`.
 *
 * A fetch that misses the render deadline keeps running in the background and
 * lands here once it settles; this pushes it to every connected chat
 * WebSocket client so the composer popover can update the row after the HTTP
 * response has already returned. Mirrors `broadcastProgress` in
 * `projects-with-sessions-fetch.service.ts`.
 */

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import type { ProfileUsageEnvelope } from './profile-usage.types.js';

export function broadcastProfileUsage(envelope: ProfileUsageEnvelope): void {
  const message = JSON.stringify({ kind: 'profile_usage', envelope });

  connectedClients.forEach((client: RealtimeClientConnection) => {
    if (client.readyState !== WS_OPEN_STATE) {
      return;
    }
    // One client's socket throwing (e.g. mid-close) must not stop the
    // broadcast from reaching everyone else.
    try {
      client.send(message);
    } catch (error) {
      console.error('[profile-usage] broadcast to a client failed:', error);
    }
  });
}
