/**
 * notify-hub webhook channel.
 *
 * POSTs to an external push service so the operator gets a phone notification
 * when a run finishes, fails, or an approval sits unanswered. It is decoupled
 * from the agent session: fire-and-forget with a hard 5s timeout, and any
 * transport, DB or formatting failure is swallowed so a down notify-hub can
 * never stall or break the coding session (HUB-09).
 *
 * Two gates decide whether an event pages the phone, both evaluated per event
 * so a change takes effect on the next notification without a restart: the hub
 * config (DB over env) must carry URL + token, and the event's project must
 * have its bell turned on.
 */

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import {
  getNotifyHubConfig,
  isNotifyHubConfigured,
} from '@/modules/notifications/services/notify-hub-config.service.js';
import { buildNotifyHubRequestBody } from '@/modules/notifications/services/notify-hub-payload.js';

// Approvals only warrant a push once they have been waiting a while; a quick
// allow/deny should not page the phone. The scheduled webhook is cancelled the
// moment the approval resolves (see cancelPendingPermissionWebhook), so it fires
// only when the request is still genuinely pending past this threshold.
const PERMISSION_PENDING_THRESHOLD_MS = 60_000;

// Hard ceiling on the outbound request so a hung notify-hub cannot pin a socket
// open indefinitely; the session never awaits this, but the timer bounds it.
const WEBHOOK_TIMEOUT_MS = 5_000;

// The only event codes this channel forwards. Anything else (e.g. in-app-only
// codes like agent.notification) is ignored so notify-hub stays signal, not noise.
const WEBHOOK_EVENT_CODES = new Set(['run.stopped', 'run.failed', 'permission.required']);

// requestId -> setTimeout handle for permission approvals awaiting the threshold.
const pendingPermissionWebhooks = new Map();

function logChannelError(context, error) {
  console.error(`[notify-hub webhook] ${context}:`, error?.message || error);
}

// Never throws: config lives in sqlite, and a DB hiccup must degrade to "not
// configured" instead of bubbling out of isEnabled() into the session.
function readConfig() {
  try {
    return getNotifyHubConfig();
  } catch (error) {
    logChannelError('config read failed', error);
    return null;
  }
}

/** Channel is live only when both endpoint and token resolve (DB first, env fallback). */
function isWebhookConfigured() {
  const config = readConfig();
  return Boolean(config && isNotifyHubConfigured(config));
}

// Recovers the project directory when the provider did not pass one. The
// sessionId may be the app id or the provider-native id, so both are tried.
function resolveSessionProjectPath(sessionId) {
  if (!sessionId) {
    return null;
  }
  try {
    const row = sessionsDb.getSessionById(sessionId) || sessionsDb.getSessionByProviderSessionId(sessionId);
    return row?.project_path || null;
  } catch (error) {
    logChannelError('session lookup failed', error);
    return null;
  }
}

/**
 * Maps an event to the project row that owns it. Null when it belongs to no
 * project (e.g. system events with no path and no session) — "do not send".
 */
function resolveNotifyProject(event) {
  const metaPath = typeof event?.meta?.projectPath === 'string' ? event.meta.projectPath.trim() : '';
  const projectPath = metaPath || resolveSessionProjectPath(event?.sessionId);
  if (!projectPath) {
    return null;
  }
  try {
    return projectsDb.getProjectPath(projectPath);
  } catch (error) {
    logChannelError('project lookup failed', error);
    return null;
  }
}

// Rejects on transport error or timeout; callers wrap this so the rejection
// never reaches the session.
async function postToNotifyHub(body, config) {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(abortTimer);
  }
}

/**
 * Evaluates both gates and dispatches. Returns undefined when a gate blocks,
 * and never throws, so the fire-and-forget invariant holds even if the payload
 * builder or the DB misbehaves.
 */
function dispatchIfAllowed(event) {
  try {
    const config = readConfig();
    if (!config || !isNotifyHubConfigured(config)) {
      return undefined;
    }
    const project = resolveNotifyProject(event);
    if (!project || !project.notifyEnabled) {
      return undefined;
    }
    const body = buildNotifyHubRequestBody({ event, project, timezone: config.timezone });
    return postToNotifyHub(body, config).catch((error) => {
      logChannelError('send failed', error);
    });
  } catch (error) {
    logChannelError('dispatch failed', error);
    return undefined;
  }
}

/** Stable key for a permission approval's scheduled webhook. */
function permissionKey(event) {
  return event?.meta?.requestId || event?.dedupeKey || `permission:${event?.sessionId || 'none'}`;
}

/**
 * Channel entry point. Immediate events post right away; permission approvals are
 * deferred and only post if still pending after PERMISSION_PENDING_THRESHOLD_MS.
 * Both gates are re-evaluated inside the timer, not at schedule time: the hub
 * config or the project's bell may change during that minute. Returns the
 * dispatch promise for immediate events (already failure-swallowing) so callers
 * may await it in tests; returns undefined for deferred ones.
 */
function sendWebhookNotification({ event } = {}) {
  if (!event || !WEBHOOK_EVENT_CODES.has(event.code)) {
    return undefined;
  }

  if (event.code === 'permission.required') {
    const key = permissionKey(event);
    // Re-arming would double-fire; the first schedule owns the window.
    if (pendingPermissionWebhooks.has(key)) {
      return undefined;
    }
    const handle = setTimeout(() => {
      pendingPermissionWebhooks.delete(key);
      dispatchIfAllowed(event);
    }, PERMISSION_PENDING_THRESHOLD_MS);
    // Do not keep the process alive solely for a pending push.
    if (typeof handle.unref === 'function') {
      handle.unref();
    }
    pendingPermissionWebhooks.set(key, handle);
    return undefined;
  }

  return dispatchIfAllowed(event);
}

/**
 * Cancels a scheduled permission webhook once the approval resolves (allow,
 * deny, timeout, abort), so a request answered inside the threshold never pages.
 */
function cancelPendingPermissionWebhook(requestId) {
  const handle = pendingPermissionWebhooks.get(requestId);
  if (handle) {
    clearTimeout(handle);
    pendingPermissionWebhooks.delete(requestId);
  }
}

const webhookNotifyChannel = {
  id: 'webhook',
  isEnabled: () => isWebhookConfigured(),
  send: ({ event }) => sendWebhookNotification({ event }),
};

export {
  webhookNotifyChannel,
  sendWebhookNotification,
  resolveNotifyProject,
  cancelPendingPermissionWebhook,
  isWebhookConfigured,
  PERMISSION_PENDING_THRESHOLD_MS,
  WEBHOOK_TIMEOUT_MS,
};
