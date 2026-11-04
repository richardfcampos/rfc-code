/**
 * Turns a session lifecycle transition into signed webhook deliveries.
 *
 * The entrypoint wires it: it subscribes this dispatcher to the lifecycle feed
 * and injects the summary builder, so the notifications module depends on
 * neither the registry nor the session summary module (both would close an
 * import cycle through the websocket module). Everything here is
 * fire-and-forget from the session's point of view: no path throws or rejects.
 */

import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { notificationChannelEndpointsDb, projectsDb, sessionsDb } from '@/modules/database/index.js';
import type { SessionSummary } from '@/modules/session-summary/index.js';

import { deliverSessionWebhook, defaultSessionWebhookTransport, type SessionWebhookDeliveryOutcome, type SessionWebhookTransport } from './session-webhook-delivery.js';
import {
  SESSION_WEBHOOK_CHANNEL,
  matchesTransition,
  readSessionWebhookMetadata,
  type SessionWebhookMetadata,
} from './session-webhook-endpoints.service.js';

/** The slice of a lifecycle transition the dispatcher reads (mirrors the websocket module's type without importing it). */
export type SessionWebhookTransitionInput = {
  sessionId: string;
  provider: string;
  status: 'idle' | 'error' | 'waiting_approval';
  startedAt: string | null;
  finishedAt: string | null;
  lastSeq: number;
  requestId?: string | null;
  error?: string | null;
};

export type SessionWebhookDispatcherDeps = {
  buildSummary: (sessionId: string) => Promise<SessionSummary | null>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

type ResolvedProject = { id: string | null; name: string; path: string | null };

let deps: SessionWebhookDispatcherDeps | null = null;

export function configureSessionWebhookDispatcher(next: SessionWebhookDispatcherDeps): void {
  deps = next;
}

function transport(): SessionWebhookTransport {
  return {
    fetch: deps?.fetch ?? defaultSessionWebhookTransport.fetch,
    sleep: deps?.sleep ?? defaultSessionWebhookTransport.sleep,
  };
}

function nowIso(): string {
  return (deps?.now?.() ?? new Date()).toISOString();
}

function newDeliveryId(): string {
  return `dlv_${randomBytes(8).toString('hex')}`;
}

function resolveProject(sessionId: string | null): ResolvedProject {
  try {
    const session = sessionId ? sessionsDb.getSessionById(sessionId) : null;
    const projectPath = session?.project_path ?? null;
    const row = projectPath ? projectsDb.getProjectPath(projectPath) : null;
    const name = row?.custom_project_name?.trim() || (projectPath ? path.basename(projectPath) : '') || 'unknown';
    return { id: row?.project_id ?? null, name, path: projectPath };
  } catch (error) {
    console.error('[session-webhook] project lookup failed:', error);
    return { id: null, name: 'unknown', path: null };
  }
}

function listTargets(): Array<{ endpointId: string; userId: number; metadata: SessionWebhookMetadata }> {
  try {
    return notificationChannelEndpointsDb
      .getEnabledEndpointsForChannel(SESSION_WEBHOOK_CHANNEL)
      .map((row) => ({ endpointId: row.endpoint_id, userId: row.user_id, metadata: readSessionWebhookMetadata(notificationChannelEndpointsDb.parseMetadata(row.metadata_json)) }))
      .filter((entry): entry is { endpointId: string; userId: number; metadata: SessionWebhookMetadata } => entry.metadata !== null);
  } catch (error) {
    console.error('[session-webhook] endpoint lookup failed:', error);
    return [];
  }
}

async function safeSummary(sessionId: string): Promise<SessionSummary | null> {
  if (!deps) return null;
  try {
    return await deps.buildSummary(sessionId);
  } catch (error) {
    console.error('[session-webhook] summary failed, sending without it:', error);
    return null;
  }
}

function send(
  target: { endpointId: string; userId: number | null; metadata: SessionWebhookMetadata },
  event: string,
  sessionId: string | null,
  payload: Record<string, unknown>,
): Promise<SessionWebhookDeliveryOutcome> {
  const deliveryId = newDeliveryId();
  const rawBody = JSON.stringify({ ...payload, deliveryId });
  return deliverSessionWebhook({
    target: { endpointId: target.endpointId, userId: target.userId, url: target.metadata.url, secret: target.metadata.secret },
    deliveryId,
    event,
    sessionId,
    rawBody,
    transport: transport(),
  });
}

/** A burst of completions must not fork one git+fetch pipeline per session at once. */
const MAX_IN_FLIGHT_DISPATCHES = 4;
let inFlight = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT_DISPATCHES) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  waiting.shift()?.();
}

/** Fans one transition out to every matching endpoint. Resolves when all deliveries settled; never rejects. */
export async function dispatchSessionWebhookTransition(transition: SessionWebhookTransitionInput): Promise<void> {
  await acquireSlot();
  try {
    await dispatchUnbounded(transition);
  } finally {
    releaseSlot();
  }
}

async function dispatchUnbounded(transition: SessionWebhookTransitionInput): Promise<void> {
  try {
    const event = `session.${transition.status}`;
    const project = resolveProject(transition.sessionId);
    const targets = listTargets().filter((target) =>
      matchesTransition(target.metadata, { event, projectId: project.id, projectPath: project.path, sessionId: transition.sessionId }),
    );
    if (targets.length === 0) return;

    const summary = await safeSummary(transition.sessionId);
    const payload = {
      event,
      sentAt: nowIso(),
      sessionId: transition.sessionId,
      provider: transition.provider,
      project,
      status: transition.status,
      startedAt: transition.startedAt,
      finishedAt: transition.finishedAt,
      lastSeq: transition.lastSeq,
      requestId: transition.requestId ?? null,
      error: transition.error ?? null,
      summary,
    };
    await Promise.all(targets.map((target) => send(target, event, transition.sessionId, payload)));
  } catch (error) {
    console.error('[session-webhook] dispatch failed:', error);
  }
}

export type SessionWebhookTestResult = SessionWebhookDeliveryOutcome | { ok: false; error: 'ENDPOINT_NOT_FOUND' | 'ENDPOINT_INVALID' };

/** Sends a `session.test` event through the real delivery path (retries and log included). */
export async function sendSessionWebhookTest(userId: number, endpointId: string): Promise<SessionWebhookTestResult> {
  const row = notificationChannelEndpointsDb.getEndpoint(userId, SESSION_WEBHOOK_CHANNEL, endpointId);
  if (!row) return { ok: false, error: 'ENDPOINT_NOT_FOUND' };
  const metadata = readSessionWebhookMetadata(notificationChannelEndpointsDb.parseMetadata(row.metadata_json));
  if (!metadata) return { ok: false, error: 'ENDPOINT_INVALID' };

  const payload = {
    event: 'session.test',
    sentAt: nowIso(),
    sessionId: null,
    provider: null,
    project: null,
    status: 'test',
    startedAt: null,
    finishedAt: null,
    lastSeq: 0,
    requestId: null,
    error: null,
    summary: null,
  };
  return send({ endpointId: row.endpoint_id, userId, metadata }, 'session.test', null, payload);
}
