/**
 * The outbound side of a bot turn: the socket a browser would own.
 */

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import type { JsonObject } from './grokbot-mcp.types.js';

/**
 * The socket a browser would own. With no originating client the writer's
 * output is fanned out to every open client (whoever has the session on
 * screen sees the turn arrive) and, when the caller waits, also parsed into
 * this call's own event list.
 */
export function createGatewayConnection(collect: ((frame: JsonObject) => void) | null): RealtimeClientConnection {
  return {
    readyState: WS_OPEN_STATE,
    send(data: string): void {
      connectedClients.forEach((client: RealtimeClientConnection) => {
        if (client.readyState !== WS_OPEN_STATE) return;
        try {
          client.send(data);
        } catch (error) {
          console.error('[grokbot-mcp] fan-out of a bot turn failed for a client:', error);
        }
      });
      if (!collect) return;
      try {
        collect(JSON.parse(data) as JsonObject);
      } catch (error) {
        console.error('[grokbot-mcp] could not parse an outbound chat frame:', error);
      }
    },
  };
}

