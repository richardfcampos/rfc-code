import { IS_PLATFORM } from '../../../constants/config';
import type { ShellIncomingMessage, ShellOutgoingMessage } from '../types/types';

export function getShellWebSocketUrl(isTrusted: boolean): string | null {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/shell`;
  }

  // Trusted mode (runtime AUTH_MODE=trusted, not the build-time IS_PLATFORM flag):
  // the server skips WS auth entirely, so no token is ever issued to attach here.
  if (isTrusted) {
    return `${protocol}//${window.location.host}/shell`;
  }

  const token = localStorage.getItem('auth-token');
  if (!token) {
    console.error('No authentication token found for Shell WebSocket connection');
    return null;
  }

  return `${protocol}//${window.location.host}/shell?token=${encodeURIComponent(token)}`;
}

export function parseShellMessage(payload: string): ShellIncomingMessage | null {
  try {
    return JSON.parse(payload) as ShellIncomingMessage;
  } catch {
    return null;
  }
}

export function sendSocketMessage(ws: WebSocket | null, message: ShellOutgoingMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}