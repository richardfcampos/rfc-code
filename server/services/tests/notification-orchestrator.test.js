import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import webPush from 'web-push';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  pushSubscriptionsDb,
  sessionsDb,
  userDb,
} from '../../modules/database/index.js';

import { buildRunFailedEvent, buildRunStoppedEvent, notifyRunStopped } from '../notification-orchestrator.js';

async function withIsolatedDatabase(runTest) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'notification-orchestrator-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('push payload uses the app session id when notified with a provider session id', async () => {
  const originalSendNotification = webPush.sendNotification;
  const sentPayloads = [];

  webPush.sendNotification = async (_subscription, payload) => {
    sentPayloads.push(JSON.parse(payload));
    return {};
  };

  try {
    await withIsolatedDatabase(async () => {
      const user = userDb.createUser('notify-user', 'hash');
      const userId = Number(user.id);

      notificationPreferencesDb.updatePreferences(userId, {
        channels: { webPush: true },
        events: { actionRequired: true, stop: true, error: true },
      });
      pushSubscriptionsDb.saveSubscription(userId, 'https://example.test/push', 'p256dh', 'auth');
      sessionsDb.createAppSession('app-session-1', 'claude', '/workspace/demo');
      sessionsDb.assignProviderSessionId('app-session-1', 'claude-native-1');

      notifyRunStopped({
        userId,
        provider: 'claude',
        sessionId: 'claude-native-1',
        stopReason: 'completed',
      });

      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(sentPayloads.length, 1);
      assert.equal(sentPayloads[0]?.data?.sessionId, 'app-session-1');
      assert.match(sentPayloads[0]?.data?.tag, /app-session-1/);
    });
  } finally {
    webPush.sendNotification = originalSendNotification;
  }
});

test('buildRunStoppedEvent carries projectPath and startedAt into meta for the notify-hub channel', () => {
  const startedAt = Date.now();
  const event = buildRunStoppedEvent({
    provider: 'claude',
    sessionId: 'session-1',
    stopReason: 'completed',
    sessionName: 'Demo session',
    projectPath: '/workspace/demo',
    startedAt,
  });

  assert.equal(event.meta.projectPath, '/workspace/demo');
  assert.equal(event.meta.startedAt, startedAt);
});

test('buildRunStoppedEvent defaults projectPath and startedAt to null when omitted', () => {
  const event = buildRunStoppedEvent({ provider: 'claude', sessionId: 'session-1' });

  assert.equal(event.meta.projectPath, null);
  assert.equal(event.meta.startedAt, null);
});

test('buildRunFailedEvent carries projectPath and startedAt into meta for the notify-hub channel', () => {
  const startedAt = Date.now();
  const event = buildRunFailedEvent({
    provider: 'codex',
    sessionId: 'session-2',
    error: new Error('boom'),
    sessionName: 'Demo session',
    projectPath: '/workspace/demo',
    startedAt,
  });

  assert.equal(event.meta.projectPath, '/workspace/demo');
  assert.equal(event.meta.startedAt, startedAt);
  assert.equal(event.meta.error, 'boom');
});
