import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureTaskMasterTasksWatcher, stopAllTaskMasterTasksWatchers } from './taskmaster-file-watcher.js';

const FAKE_WSS = { clients: new Set() };

function waitForBroadcast(broadcasts, minimumCount, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      if (broadcasts.length >= minimumCount) {
        return resolve();
      }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${minimumCount} broadcast(s); got ${broadcasts.length}`));
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

test('taskmaster tasks watcher', async (t) => {
  let projectDir = null;

  t.beforeEach(async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), 'tm-watcher-'));
  });

  t.afterEach(async () => {
    await stopAllTaskMasterTasksWatchers();
    await rm(projectDir, { recursive: true, force: true });
  });

  await t.test('broadcasts when tasks.json changes on disk', async () => {
    const tasksDir = path.join(projectDir, '.taskmaster', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    const tasksFile = path.join(tasksDir, 'tasks.json');
    await writeFile(tasksFile, JSON.stringify({ master: { tasks: [] } }));

    const broadcasts = [];
    ensureTaskMasterTasksWatcher(FAKE_WSS, 'proj-1', projectDir, (wss, projectId) => {
      broadcasts.push({ wss, projectId });
    });

    // Give chokidar a beat to finish its initial scan before mutating the file.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await writeFile(tasksFile, JSON.stringify({ master: { tasks: [{ id: 1 }] } }));

    await waitForBroadcast(broadcasts, 1);
    assert.equal(broadcasts[0].projectId, 'proj-1');
    assert.equal(broadcasts[0].wss, FAKE_WSS);
  });

  await t.test('broadcasts when tasks.json is created after the watcher armed', async () => {
    const broadcasts = [];
    ensureTaskMasterTasksWatcher(FAKE_WSS, 'proj-2', projectDir, (wss, projectId) => {
      broadcasts.push({ wss, projectId });
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const tasksDir = path.join(projectDir, '.taskmaster', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(path.join(tasksDir, 'tasks.json'), JSON.stringify({ master: { tasks: [] } }));

    await waitForBroadcast(broadcasts, 1);
    assert.equal(broadcasts[0].projectId, 'proj-2');
  });

  await t.test('is idempotent per projectId and debounces bursts', async () => {
    const tasksDir = path.join(projectDir, '.taskmaster', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    const tasksFile = path.join(tasksDir, 'tasks.json');
    await writeFile(tasksFile, '{}');

    const broadcasts = [];
    const record = (wss, projectId) => broadcasts.push(projectId);
    ensureTaskMasterTasksWatcher(FAKE_WSS, 'proj-3', projectDir, record);
    // Second call for the same project must not create a second watcher.
    ensureTaskMasterTasksWatcher(FAKE_WSS, 'proj-3', projectDir, record);

    await new Promise((resolve) => setTimeout(resolve, 300));
    // Burst of writes inside the debounce window → single broadcast.
    await writeFile(tasksFile, '{"a":1}');
    await writeFile(tasksFile, '{"a":2}');
    await writeFile(tasksFile, '{"a":3}');

    await waitForBroadcast(broadcasts, 1);
    // Wait past the debounce window to catch any extra broadcasts.
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(broadcasts.length, 1);
  });

  await t.test('ignores calls with missing wss, projectId, or path', async () => {
    const broadcasts = [];
    const record = (wss, projectId) => broadcasts.push(projectId);
    ensureTaskMasterTasksWatcher(null, 'proj-4', projectDir, record);
    ensureTaskMasterTasksWatcher(FAKE_WSS, null, projectDir, record);
    ensureTaskMasterTasksWatcher(FAKE_WSS, 'proj-4', null, record);

    const tasksDir = path.join(projectDir, '.taskmaster', 'tasks');
    await mkdir(tasksDir, { recursive: true });
    await writeFile(path.join(tasksDir, 'tasks.json'), '{}');

    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(broadcasts.length, 0);
  });
});
