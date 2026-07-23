/**
 * notify-hub webhook channel.
 *
 * A pluggable notification channel that POSTs to an external push service
 * (notify-hub) so the operator gets a phone notification when a run finishes,
 * fails, or an approval sits unanswered. It is intentionally decoupled from the
 * agent session: the webhook is fire-and-forget with a hard 5s timeout, and any
 * transport failure is swallowed so a down notify-hub can never stall or break
 * the coding session (HUB-09).
 *
 * Configuration is env-driven: the channel is disabled entirely unless both
 * NOTIFY_URL and NOTIFY_TOKEN are present, so a deployment without notify-hub
 * simply never posts.
 */

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

// Codes that page with elevated priority: a failure or a stuck approval is
// actionable; a normal completion is informational.
const HIGH_PRIORITY_CODES = new Set(['run.failed', 'permission.required']);

// requestId -> setTimeout handle for permission approvals awaiting the threshold.
const pendingPermissionWebhooks = new Map();

/** Channel is live only when both endpoint and token are configured. */
function isWebhookConfigured() {
  return Boolean(process.env.NOTIFY_URL && process.env.NOTIFY_TOKEN);
}

/**
 * Derives the notify-hub request body from the already-built notification
 * payload. Reuses the orchestrator's title/body so wording stays consistent
 * across channels; only the priority is channel-specific.
 */
function buildWebhookRequestBody(event, payload) {
  return {
    title: payload?.title || 'RFC Code',
    message: payload?.body || event?.code || 'Notification',
    priority: HIGH_PRIORITY_CODES.has(event?.code) ? 'high' : 'default',
  };
}

/**
 * Performs the actual POST with a bounded timeout. Rejects on transport error
 * or timeout; callers wrap this so the rejection never reaches the session.
 */
async function postToNotifyHub(body) {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(process.env.NOTIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.NOTIFY_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(abortTimer);
  }
}

/**
 * Fire-and-forget dispatch: always resolves. A failing or unreachable notify-hub
 * is logged and swallowed so the invariant "webhook failure never affects the
 * session" holds.
 */
function dispatchWebhook(event, payload) {
  return postToNotifyHub(buildWebhookRequestBody(event, payload)).catch((error) => {
    console.error('[notify-hub webhook] send failed:', error?.message || error);
  });
}

/** Stable key for a permission approval's scheduled webhook. */
function permissionKey(event) {
  return event?.meta?.requestId || event?.dedupeKey || `permission:${event?.sessionId || 'none'}`;
}

/**
 * Channel entry point. Immediate events post right away; permission approvals are
 * deferred and only post if still pending after PERMISSION_PENDING_THRESHOLD_MS.
 * Returns the dispatch promise for immediate events (already failure-swallowing)
 * so callers may await completion in tests; returns undefined for deferred ones.
 */
function sendWebhookNotification({ event, payload } = {}) {
  if (!isWebhookConfigured() || !event || !WEBHOOK_EVENT_CODES.has(event.code)) {
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
      dispatchWebhook(event, payload);
    }, PERMISSION_PENDING_THRESHOLD_MS);
    // Do not keep the process alive solely for a pending push.
    if (typeof handle.unref === 'function') {
      handle.unref();
    }
    pendingPermissionWebhooks.set(key, handle);
    return undefined;
  }

  return dispatchWebhook(event, payload);
}

/**
 * Cancels a scheduled permission webhook once the approval resolves (allow,
 * deny, timeout, or abort). Called from the approval lifecycle so a request
 * answered inside the threshold never pages.
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
  send: ({ event, payload }) => sendWebhookNotification({ event, payload }),
};

export {
  webhookNotifyChannel,
  sendWebhookNotification,
  buildWebhookRequestBody,
  cancelPendingPermissionWebhook,
  isWebhookConfigured,
  PERMISSION_PENDING_THRESHOLD_MS,
  WEBHOOK_TIMEOUT_MS,
};
