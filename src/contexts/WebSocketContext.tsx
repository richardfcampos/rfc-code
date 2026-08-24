import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';
import {
  computeReconnectDelayMs,
  hasLivenessProbeTimedOut,
  shouldReconnectImmediatelyOnWake,
} from './utils/websocket-liveness';

/**
 * How long a wake-triggered `chat.ping` liveness probe waits for a reply (or
 * any other frame — both count as proof of life) before the socket is
 * treated as half-open and force-reconnected.
 */
const LIVENESS_PROBE_TIMEOUT_MS = 3000;

/**
 * One frame received from the chat websocket. The server guarantees every
 * frame carries a `kind` (provider message kinds plus gateway kinds such as
 * `chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`). The synthetic `websocket_reconnected` kind is injected
 * client-side when the socket re-opens after a drop.
 */
export type ServerEvent = {
  kind?: string;
  type?: string;
  sessionId?: string;
  seq?: number;
  [key: string]: unknown;
};

type ServerEventListener = (event: ServerEvent) => void;

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames can never be coalesced or
   * dropped the way a single "latest message" state slot could.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  /**
   * Legacy state-based access to the most recent frame.
   *
   * Kept only for low-frequency consumers (TaskMaster broadcasts). High-rate
   * chat streams must use `subscribe` — React may batch state updates, which
   * makes `latestMessage` lossy under load.
   */
  latestMessage: ServerEvent | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null, isTrusted: boolean) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  // Trusted mode (runtime AUTH_MODE=trusted, not the build-time IS_PLATFORM flag):
  // the server skips WS auth entirely, so no token is ever issued to attach here.
  if (isTrusted) return `${protocol}//${window.location.host}/ws`;
  if (!token) return null;
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  /**
   * Listener registry for the subscribe API. A ref (not state) because the
   * set must be readable synchronously inside `onmessage` and never trigger
   * re-renders of the provider tree.
   */
  const listenersRef = useRef(new Set<ServerEventListener>());
  const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Reset to 0 on every successful open; drives the exponential backoff delay
  // for the next reconnect attempt after a drop.
  const reconnectAttemptRef = useRef(0);
  // Timestamp of the last frame received on the current socket (any message,
  // including a `chat_pong` reply) — the signal the wake-up liveness probe
  // checks against to decide whether a socket that still claims OPEN is
  // actually half-open.
  const lastActivityAtRef = useRef<number | null>(null);
  const livenessProbeRef = useRef<{ sentAt: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const { token, isTrusted } = useAuth();

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
    setLatestMessage(event);
  }, []);

  const clearLivenessProbe = useCallback(() => {
    if (livenessProbeRef.current) {
      clearTimeout(livenessProbeRef.current.timer);
      livenessProbeRef.current = null;
    }
  }, []);

  useEffect(() => {
    // The cleanup below sets unmountedRef = true. Without this reset, every
    // re-run of the effect (e.g. on token refresh) would short-circuit connect()
    // at its unmounted guard and leave the socket permanently disconnected.
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clearLivenessProbe();
      if (wsRef.current) {
        // wsRef is assigned at construction time (below), not only on open,
        // so a socket still stuck in CONNECTING is closed here too instead
        // of being orphaned to finish connecting after the provider using it
        // has already unmounted.
        wsRef.current.close();
      }
    };
  }, [token, isTrusted]); // reconnect whenever the token or trusted-mode status changes

  const connect = useCallback(() => {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    try {
      // Construct WebSocket URL
      const wsUrl = buildWebSocketUrl(token, isTrusted);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      const websocket = new WebSocket(wsUrl);
      // Assigned immediately (before onopen) so close() during cleanup or a
      // forced reconnect can always reach this socket, even mid-handshake.
      wsRef.current = websocket;

      websocket.onopen = () => {
        setIsConnected(true);
        reconnectAttemptRef.current = 0;
        lastActivityAtRef.current = Date.now();
        if (hasConnectedRef.current) {
          // This is a reconnect — signal so components can catch up on missed messages
          dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
        }
        hasConnectedRef.current = true;
      };

      websocket.onmessage = (event) => {
        lastActivityAtRef.current = Date.now();
        try {
          const data = JSON.parse(event.data) as ServerEvent;
          if (data.kind === 'chat_pong') {
            // Liveness-probe reply only — recorded above, nothing for consumers to see.
            return;
          }
          dispatch(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        if (wsRef.current === websocket) {
          wsRef.current = null;
        }
        clearLivenessProbe();

        const delay = computeReconnectDelayMs(reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return; // Prevent reconnection if unmounted
          connect();
        }, delay);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, isTrusted, dispatch, clearLivenessProbe]); // reconnect whenever the token or trusted-mode status changes

  /**
   * Drops the current socket (whatever its state) and reconnects right away,
   * bypassing the backoff timer. Used when a wake event proves the socket is
   * dead or half-open — waiting on a fixed retry timer that may never fire
   * on a half-open socket is exactly the failure mode this closes.
   */
  const forceReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    clearLivenessProbe();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const staleSocket = wsRef.current;
    wsRef.current = null;
    if (staleSocket) {
      // Detach handlers first so the stale socket's own close/error (if it
      // ever fires) cannot trigger a second, redundant reconnect on top of
      // the one started below.
      staleSocket.onopen = null;
      staleSocket.onmessage = null;
      staleSocket.onclose = null;
      staleSocket.onerror = null;
      try {
        staleSocket.close();
      } catch {
        // already closed/closing — nothing to clean up
      }
    }

    setIsConnected(false);
    connect();
  }, [connect, clearLivenessProbe]);

  /**
   * Runs on `visibilitychange` (tab foregrounded) and `online` (network back)
   * events. A socket that is not OPEN is known-dead already; one that claims
   * OPEN might still be half-open after sleep/network-switch, so it is probed
   * with a `chat.ping` and given a short window to answer before being
   * treated as dead.
   */
  const checkLivenessOnWake = useCallback(() => {
    if (unmountedRef.current) return;
    const socket = wsRef.current;

    if (!socket || shouldReconnectImmediatelyOnWake(socket.readyState, WebSocket.OPEN)) {
      forceReconnect();
      return;
    }

    if (livenessProbeRef.current) return; // a probe is already in flight

    const sentAt = Date.now();
    try {
      socket.send(JSON.stringify({ type: 'chat.ping' }));
    } catch {
      forceReconnect();
      return;
    }

    const timer = setTimeout(() => {
      const probe = livenessProbeRef.current;
      livenessProbeRef.current = null;
      if (!probe || unmountedRef.current) return;

      if (
        hasLivenessProbeTimedOut({
          probeSentAt: probe.sentAt,
          lastActivityAt: lastActivityAtRef.current,
          now: Date.now(),
          timeoutMs: LIVENESS_PROBE_TIMEOUT_MS,
        })
      ) {
        forceReconnect();
      }
    }, LIVENESS_PROBE_TIMEOUT_MS);

    livenessProbeRef.current = { sentAt, timer };
  }, [forceReconnect]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkLivenessOnWake();
      }
    };
    const handleOnline = () => checkLivenessOnWake();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [checkLivenessOnWake]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    subscribe,
    latestMessage,
    isConnected
  }), [sendMessage, subscribe, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
