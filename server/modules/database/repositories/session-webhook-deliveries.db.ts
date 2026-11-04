import { getConnection } from '@/modules/database/connection.js';

export type SessionWebhookDeliveryRow = {
  id: number;
  delivery_id: string;
  endpoint_id: string;
  user_id: number | null;
  event: string;
  session_id: string | null;
  attempt: number;
  ok: number;
  http_status: number | null;
  error: string | null;
  created_at: string;
};

export type RecordSessionWebhookDeliveryInput = {
  deliveryId: string;
  endpointId: string;
  userId: number | null;
  event: string;
  sessionId: string | null;
  attempt: number;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
};

export type ListSessionWebhookDeliveriesOptions = {
  endpointId?: string;
  sessionId?: string;
  userId?: number;
  limit?: number;
};

/** Rows kept per endpoint; the newest attempts are the ones that explain the current state. */
const MAX_DELIVERIES_PER_ENDPOINT = 500;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
/** Transport errors can be long; the row is a log line, not a dump. */
const MAX_ERROR_LENGTH = 500;

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIST_LIMIT);
}

export const sessionWebhookDeliveriesDb = {
  /** One row per attempt. Never stores the payload or the endpoint secret. */
  record(entry: RecordSessionWebhookDeliveryInput): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO session_webhook_deliveries
         (delivery_id, endpoint_id, user_id, event, session_id, attempt, ok, http_status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.deliveryId,
      entry.endpointId,
      entry.userId,
      entry.event,
      entry.sessionId,
      entry.attempt,
      entry.ok ? 1 : 0,
      entry.httpStatus,
      entry.error ? entry.error.slice(0, MAX_ERROR_LENGTH) : null,
    );

    db.prepare(
      `DELETE FROM session_webhook_deliveries
       WHERE endpoint_id = ?
         AND id NOT IN (
           SELECT id FROM session_webhook_deliveries
           WHERE endpoint_id = ?
           ORDER BY id DESC
           LIMIT ?
         )`,
    ).run(entry.endpointId, entry.endpointId, MAX_DELIVERIES_PER_ENDPOINT);
  },

  /** Called when an endpoint is deleted so its log does not outlive it. */
  deleteByEndpoint(endpointId: string, userId: number | null): number {
    const result = getConnection()
      .prepare('DELETE FROM session_webhook_deliveries WHERE endpoint_id = ? AND (user_id = ? OR ? IS NULL)')
      .run(endpointId, userId, userId);
    return result.changes;
  },

  /** Newest first. */
  list(options: ListSessionWebhookDeliveriesOptions = {}): SessionWebhookDeliveryRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.endpointId) {
      clauses.push('endpoint_id = ?');
      params.push(options.endpointId);
    }
    if (options.sessionId) {
      clauses.push('session_id = ?');
      params.push(options.sessionId);
    }
    if (typeof options.userId === 'number') {
      clauses.push('user_id = ?');
      params.push(options.userId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(normalizeLimit(options.limit));

    return getConnection()
      .prepare(
        `SELECT id, delivery_id, endpoint_id, user_id, event, session_id, attempt, ok, http_status, error, created_at
         FROM session_webhook_deliveries
         ${where}
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(...params) as SessionWebhookDeliveryRow[];
  },
};
