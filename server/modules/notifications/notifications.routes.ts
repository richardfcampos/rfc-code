import express from 'express';

import { notificationChannelEndpointsDb, notificationPreferencesDb, sessionWebhookDeliveriesDb } from '@/modules/database/index.js';
import {
  getNotifyHubConfig,
  isNotifyHubConfigured,
  saveNotifyHubConfig,
  sendNotifyHubTest,
  toNotifyHubPublicView,
} from '@/modules/notifications/services/notify-hub-config.service.js';
import {
  SESSION_WEBHOOK_CHANNEL,
  SessionWebhookConfigError,
  maskSessionWebhookMetadata,
  normalizeSessionWebhookUpsert,
} from '@/modules/notifications/services/session-webhook-endpoints.service.js';
import { sendSessionWebhookTest } from '@/modules/notifications/services/session-webhook-dispatcher.service.js';
import { AppError } from '@/shared/utils.js';

const router = express.Router();

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEndpoint(endpoint: any) {
  const metadata = notificationChannelEndpointsDb.parseMetadata(endpoint.metadata_json);
  return {
    id: endpoint.id,
    channel: endpoint.channel,
    endpointId: endpoint.endpoint_id,
    label: endpoint.label,
    // A session webhook endpoint carries its shared secret in metadata; it is
    // write-only and masked on every read.
    metadata: endpoint.channel === SESSION_WEBHOOK_CHANNEL ? maskSessionWebhookMetadata(metadata) : metadata,
    enabled: Boolean(endpoint.enabled),
    lastSeenAt: endpoint.last_seen_at,
    createdAt: endpoint.created_at,
    updatedAt: endpoint.updated_at,
  };
}

function readUserId(req: express.Request): number {
  const userId = Number((req as any).user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Authenticated user is missing');
  }
  return userId;
}

function updateChannelPreference(userId: number, channel: string): unknown {
  const currentPrefs = notificationPreferencesDb.getPreferences(userId);
  const hasEnabledEndpoint = notificationChannelEndpointsDb.getEnabledEndpoints(userId, channel).length > 0;
  return notificationPreferencesDb.updatePreferences(userId, {
    ...currentPrefs,
    channels: { ...currentPrefs.channels, [channel]: hasEnabledEndpoint },
  });
}

router.get('/endpoints', (req, res) => {
  try {
    const channel = readText(req.query.channel);
    if (!channel) {
      return res.status(400).json({ error: 'channel is required' });
    }

    const userId = readUserId(req);
    const endpoints = notificationChannelEndpointsDb
      .getEndpoints(userId, channel)
      .map(sanitizeEndpoint);
    return res.json({ success: true, endpoints });
  } catch (error) {
    console.error('Error fetching notification endpoints:', error);
    return res.status(500).json({ error: 'Failed to fetch notification endpoints' });
  }
});

router.post('/endpoints/current', (req, res) => {
  try {
    const { channel, endpointId, label, metadata = {}, enabled = true } = req.body || {};
    const normalizedChannel = readText(channel);
    const normalizedEndpointId = readText(endpointId);
    if (!normalizedChannel || !normalizedEndpointId) {
      return res.status(400).json({ error: 'channel and endpointId are required' });
    }

    const userId = readUserId(req);
    let storedMetadata: Record<string, unknown> = metadata && typeof metadata === 'object' ? metadata : {};
    if (normalizedChannel === SESSION_WEBHOOK_CHANNEL) {
      const existing = notificationChannelEndpointsDb.getEndpoint(userId, normalizedChannel, normalizedEndpointId);
      try {
        storedMetadata = normalizeSessionWebhookUpsert(
          storedMetadata,
          existing ? notificationChannelEndpointsDb.parseMetadata(existing.metadata_json) : null,
        );
      } catch (error) {
        if (error instanceof SessionWebhookConfigError) {
          return res.status(400).json({ error: error.message });
        }
        throw error;
      }
    }
    const endpoint = notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: normalizedChannel,
      endpointId: normalizedEndpointId,
      label,
      metadata: storedMetadata,
      enabled: enabled !== false,
    });

    const preferences = updateChannelPreference(userId, normalizedChannel);
    return res.json({ success: true, endpoint: sanitizeEndpoint(endpoint), preferences });
  } catch (error) {
    console.error('Error registering notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to register notification endpoint' });
  }
});

router.patch('/endpoints/:channel/:endpointId', (req, res) => {
  try {
    const { channel, endpointId } = req.params;
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const userId = readUserId(req);
    const updated = notificationChannelEndpointsDb.setEndpointEnabled(userId, channel, endpointId, enabled);
    if (!updated) {
      return res.status(404).json({ error: 'Notification endpoint not found' });
    }

    const endpoint = notificationChannelEndpointsDb.getEndpoint(userId, channel, endpointId);
    const preferences = updateChannelPreference(userId, channel);
    return res.json({ success: true, endpoint: endpoint ? sanitizeEndpoint(endpoint) : null, preferences });
  } catch (error) {
    console.error('Error updating notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to update notification endpoint' });
  }
});

router.delete('/endpoints/:channel/:endpointId', (req, res) => {
  try {
    const { channel, endpointId } = req.params;
    const userId = readUserId(req);
    const removed = notificationChannelEndpointsDb.removeEndpoint(userId, channel, endpointId);
    if (!removed) {
      return res.status(404).json({ error: 'Notification endpoint not found' });
    }
    if (channel === SESSION_WEBHOOK_CHANNEL) {
      sessionWebhookDeliveriesDb.deleteByEndpoint(endpointId, userId);
    }

    const preferences = updateChannelPreference(userId, channel);
    return res.json({ success: true, preferences });
  } catch (error) {
    console.error('Error removing notification endpoint:', error);
    return res.status(500).json({ error: 'Failed to remove notification endpoint' });
  }
});

router.get('/notify-hub', (req, res) => {
  try {
    return res.json({ success: true, config: toNotifyHubPublicView(getNotifyHubConfig()) });
  } catch (error) {
    console.error('Error fetching notify-hub config:', error);
    return res.status(500).json({ error: 'Failed to fetch notify-hub config' });
  }
});

router.put('/notify-hub', (req, res) => {
  try {
    const { url, token, timezone } = req.body || {};
    const config = saveNotifyHubConfig({ url, token, timezone });
    return res.json({ success: true, config: toNotifyHubPublicView(config) });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error saving notify-hub config:', error);
    return res.status(500).json({ error: 'Failed to save notify-hub config' });
  }
});

// A stored zone can be stale (env typo, removed tz name); the test push should
// still go out, so fall back to the server zone instead of failing the request.
function buildTestTimeFormatter(timezone: string | null): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
  try {
    return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: timezone || undefined });
  } catch {
    return new Intl.DateTimeFormat('pt-BR', options);
  }
}

router.post('/notify-hub/test', async (req, res) => {
  try {
    const config = getNotifyHubConfig();
    if (!isNotifyHubConfigured(config)) {
      return res.status(400).json({ ok: false, error: 'notify-hub não configurado' });
    }

    const now = new Date();
    const timeFormatter = buildTestTimeFormatter(config.timezone);

    const result = await sendNotifyHubTest(config, {
      title: '🔔 RFC Code — teste',
      message: `Notificações do notify-hub configuradas. ${timeFormatter.format(now)}`,
      priority: 'default',
      metadata: { event: 'test', timestamp: now.toISOString() },
    });
    return res.json({ success: result.ok, ...result });
  } catch (error) {
    console.error('Error sending notify-hub test:', error);
    return res.status(500).json({ ok: false, error: 'Failed to send notify-hub test' });
  }
});

router.post('/session-webhooks/:endpointId/test', async (req, res) => {
  try {
    const userId = readUserId(req);
    const result = await sendSessionWebhookTest(userId, req.params.endpointId);
    if (!result.ok && 'error' in result && result.error === 'ENDPOINT_NOT_FOUND') {
      return res.status(404).json({ ok: false, error: 'Session webhook endpoint not found' });
    }
    return res.json({ success: result.ok, ...result });
  } catch (error) {
    console.error('Error sending session webhook test:', error);
    return res.status(500).json({ ok: false, error: 'Failed to send session webhook test' });
  }
});

router.get('/session-webhooks/deliveries', (req, res) => {
  try {
    const userId = readUserId(req);
    const limitText = readText(req.query.limit);
    const limit = limitText ? Number.parseInt(limitText, 10) : undefined;
    const deliveries = sessionWebhookDeliveriesDb
      .list({
        userId,
        endpointId: readText(req.query.endpointId) || undefined,
        sessionId: readText(req.query.sessionId) || undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      })
      .map((row) => ({
        id: row.id,
        deliveryId: row.delivery_id,
        endpointId: row.endpoint_id,
        event: row.event,
        sessionId: row.session_id,
        attempt: row.attempt,
        ok: Boolean(row.ok),
        httpStatus: row.http_status,
        error: row.error,
        createdAt: row.created_at,
      }));
    return res.json({ success: true, deliveries });
  } catch (error) {
    console.error('Error listing session webhook deliveries:', error);
    return res.status(500).json({ error: 'Failed to list session webhook deliveries' });
  }
});

export default router;
