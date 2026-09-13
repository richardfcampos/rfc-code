import express from 'express';

import { notificationChannelEndpointsDb, notificationPreferencesDb } from '@/modules/database/index.js';
import {
  getNotifyHubConfig,
  isNotifyHubConfigured,
  saveNotifyHubConfig,
  sendNotifyHubTest,
  toNotifyHubPublicView,
} from '@/modules/notifications/services/notify-hub-config.service.js';
import { AppError } from '@/shared/utils.js';

const router = express.Router();

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEndpoint(endpoint: any) {
  return {
    id: endpoint.id,
    channel: endpoint.channel,
    endpointId: endpoint.endpoint_id,
    label: endpoint.label,
    metadata: notificationChannelEndpointsDb.parseMetadata(endpoint.metadata_json),
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
    const endpoint = notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: normalizedChannel,
      endpointId: normalizedEndpointId,
      label,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
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

export default router;
