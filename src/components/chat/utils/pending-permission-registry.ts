import type { PendingPermissionRequest } from '../types/types';

/**
 * Module-level registry of pending tool-permission requests keyed by app
 * session id.
 *
 * The composer banner renders from React state that only tracks the session
 * currently on screen, so a request arriving for a background session (or one
 * wiped by a remount) used to vanish until the server's 55s timeout denied it.
 * This registry keeps every session's pending requests for the lifetime of the
 * page; the view seeds its state from here on session switch, and the
 * `chat_subscribed` ack remains the authoritative reconciliation point.
 */
const pendingBySession = new Map<string, PendingPermissionRequest[]>();

export function getPendingPermissionsForSession(sessionId: string): PendingPermissionRequest[] {
  return pendingBySession.get(sessionId) ?? [];
}

/** Replace a session's pending list wholesale (used by the subscribe ack). */
export function setPendingPermissionsForSession(
  sessionId: string,
  requests: PendingPermissionRequest[],
): PendingPermissionRequest[] {
  if (requests.length === 0) {
    pendingBySession.delete(sessionId);
    return [];
  }
  pendingBySession.set(sessionId, requests);
  return requests;
}

/** Add a request (deduped by requestId) and return the session's next list. */
export function addPendingPermission(
  sessionId: string,
  request: PendingPermissionRequest,
): PendingPermissionRequest[] {
  const current = pendingBySession.get(sessionId) ?? [];
  if (current.some((entry) => entry.requestId === request.requestId)) {
    return current;
  }
  const next = [...current, request];
  pendingBySession.set(sessionId, next);
  return next;
}

/** Remove a request by id and return the session's next list. */
export function removePendingPermission(
  sessionId: string,
  requestId: string,
): PendingPermissionRequest[] {
  const current = pendingBySession.get(sessionId) ?? [];
  const next = current.filter((entry) => entry.requestId !== requestId);
  if (next.length === 0) {
    pendingBySession.delete(sessionId);
  } else {
    pendingBySession.set(sessionId, next);
  }
  return next;
}

export function clearPendingPermissionsForSession(sessionId: string): void {
  pendingBySession.delete(sessionId);
}
