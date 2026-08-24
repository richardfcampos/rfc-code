import type { Server as HttpServer } from 'node:http';

import { WebSocketServer, type VerifyClientCallbackSync } from 'ws';

import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { verifyWebSocketClient } from '@/modules/websocket/services/websocket-auth.service.js';
import { handlePluginWsProxy } from '@/modules/websocket/services/plugin-websocket-proxy.service.js';
import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';
import { handleDesktopNotificationsConnection } from '@/modules/notifications/index.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type WebSocketServerDependencies = {
  verifyClient: Parameters<typeof verifyWebSocketClient>[1];
  chat: Parameters<typeof handleChatConnection>[2];
  shell: Parameters<typeof handleShellConnection>[1];
  getPluginPort: Parameters<typeof handlePluginWsProxy>[2];
};

/** Minimal subset of `ws.WebSocket` the heartbeat needs — narrowed for testability. */
export type HeartbeatSocket = {
  readyState: number;
  OPEN: number;
  ping: () => void;
  terminate: () => void;
  on: (event: 'pong' | 'close' | 'error', listener: () => void) => unknown;
  off: (event: 'pong' | 'close' | 'error', listener: () => void) => unknown;
};

export type HeartbeatOptions = {
  intervalMs?: number;
  maxMissedPongs?: number;
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 2;

/**
 * Wires ping/pong liveness tracking onto a connected websocket so a half-open
 * peer (network drop without a clean close frame — laptop sleep, dead
 * reverse-proxy hop, cable pull) is detected and torn down instead of
 * appearing "connected" forever. Also keeps the existing behavior of pinging
 * across reverse-proxy idle timeouts (Cloudflare ~100s, AWS ALB 60s, nginx
 * 60s, etc.) — ws library heartbeat is opt-in.
 *
 * `isAlive` is set false right before each ping and flipped back to true by
 * the `pong` handler; two consecutive intervals where it is still false means
 * two pings went unanswered, at which point the socket is terminated. One
 * missed pong alone is tolerated — it absorbs a single bad tick (background
 * tab throttling, brief GC pause) without dropping a healthy connection.
 *
 * Returns a `stop` function that clears the interval and detaches listeners;
 * it also self-invokes on the socket's own `close`/`error` events.
 */
export function attachConnectionHeartbeat(
  ws: HeartbeatSocket,
  options: HeartbeatOptions = {}
): () => void {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const maxMissedPongs = options.maxMissedPongs ?? MAX_MISSED_PONGS;

  let isAlive = true;
  let missedPongs = 0;

  const onPong = () => {
    isAlive = true;
    missedPongs = 0;
  };
  ws.on('pong', onPong);

  const interval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      return;
    }

    if (!isAlive) {
      missedPongs += 1;
      if (missedPongs >= maxMissedPongs) {
        ws.terminate();
        return;
      }
    } else {
      missedPongs = 0;
    }

    isAlive = false;
    try {
      ws.ping();
    } catch {
      // socket may have been closed concurrently — the next tick (or the
      // close/error listeners below) will clear this timer.
    }
  }, intervalMs);

  const stop = () => {
    clearInterval(interval);
    ws.off('pong', onPong);
  };
  ws.on('close', stop);
  ws.on('error', stop);

  return stop;
}

/**
 * Creates and wires the server-wide websocket gateway used for chat, shell, and
 * plugin proxy routes.
 */
export function createWebSocketServer(
  server: HttpServer,
  dependencies: WebSocketServerDependencies
): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    verifyClient: ((
      info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0]
    ) => verifyWebSocketClient(info, dependencies.verifyClient)),
  });

  wss.on('connection', (ws, request) => {
    attachConnectionHeartbeat(ws);

    const incomingRequest = request as AuthenticatedWebSocketRequest;
    const url = incomingRequest.url ?? '/';
    const pathname = new URL(url, 'http://localhost').pathname;

    if (pathname === '/shell') {
      handleShellConnection(ws, dependencies.shell);
      return;
    }

    if (pathname === '/ws') {
      handleChatConnection(ws, incomingRequest, dependencies.chat);
      return;
    }

    if (pathname === '/desktop-notifications') {
      handleDesktopNotificationsConnection(ws, incomingRequest);
      return;
    }

    if (pathname.startsWith('/plugin-ws/')) {
      handlePluginWsProxy(ws, pathname, dependencies.getPluginPort);
      return;
    }

    console.log('[WARN] Unknown WebSocket path:', pathname);
    ws.close();
  });

  return wss;
}
