/**
 * TASKMASTER TASKS FILE WATCHER
 * =============================
 *
 * Watches a project's .taskmaster/tasks/tasks.json and broadcasts a
 * `taskmaster-tasks-updated` WebSocket message when it changes on disk.
 *
 * UI-triggered mutations already broadcast from the taskmaster routes; this
 * watcher covers edits made outside the app (task-master CLI, agents, editors)
 * so an open board refreshes without a manual reload. Watchers are armed
 * lazily the first time a project's tasks are fetched, so only projects
 * someone actually opened get a watcher.
 */

import path from 'path';

import chokidar from 'chokidar';

import { broadcastTaskMasterTasksUpdate } from './taskmaster-websocket.js';

// Collapse bursts of fs events (atomic saves, multi-step CLI writes) into one broadcast.
const BROADCAST_DEBOUNCE_MS = 300;

/** @type {Map<string, { watcher: import('chokidar').FSWatcher, timer: NodeJS.Timeout | null }>} */
const activeWatchers = new Map();

/**
 * Arm a watcher for a project's tasks.json. Idempotent per projectId.
 *
 * The watch root is the project directory, not the tasks file: chokidar v4
 * never emits `add` for a path that does not exist when the watch starts, and
 * `.taskmaster/tasks/tasks.json` may be created only after the board is first
 * opened. The `ignored` filter prunes everything outside the chain
 * project → .taskmaster → tasks → tasks.json, so only those three directories
 * hold OS watches regardless of project size.
 *
 * @param {import('ws').WebSocketServer} wss - WebSocket server used for broadcasts
 * @param {string} projectId - DB id of the project
 * @param {string} projectPath - Absolute project directory
 * @param {(wss: object, projectId: string) => void} [broadcast] - Injectable for tests
 */
export function ensureTaskMasterTasksWatcher(wss, projectId, projectPath, broadcast = broadcastTaskMasterTasksUpdate) {
    if (!wss || !projectId || !projectPath || activeWatchers.has(projectId)) {
        return;
    }

    const watchRoot = path.resolve(projectPath);
    const taskMasterDir = path.join(watchRoot, '.taskmaster');
    const tasksDir = path.join(taskMasterDir, 'tasks');
    const tasksFilePath = path.join(tasksDir, 'tasks.json');
    const entry = { watcher: null, timer: null };

    const scheduleBroadcast = () => {
        if (entry.timer) {
            clearTimeout(entry.timer);
        }
        entry.timer = setTimeout(() => {
            entry.timer = null;
            broadcast(wss, projectId);
        }, BROADCAST_DEBOUNCE_MS);
    };

    const handleTasksFileEvent = (eventPath) => {
        if (path.resolve(eventPath) === tasksFilePath) {
            scheduleBroadcast();
        }
    };

    entry.watcher = chokidar.watch(watchRoot, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 2,
        // Editors and the task-master CLI replace the file on save; atomic
        // collapses the unlink+add pair into a single change event.
        atomic: true,
        ignored: (candidatePath) => {
            const resolved = path.resolve(candidatePath);
            return resolved !== watchRoot
                && resolved !== taskMasterDir
                && resolved !== tasksDir
                && resolved !== tasksFilePath;
        },
    });

    entry.watcher
        .on('add', handleTasksFileEvent)
        .on('change', handleTasksFileEvent)
        .on('unlink', handleTasksFileEvent)
        .on('error', (error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`TaskMaster tasks watcher error for project "${projectId}"`, { error: message });
        });

    activeWatchers.set(projectId, entry);
}

/**
 * Stop every active watcher. Used by tests and graceful shutdown.
 */
export async function stopAllTaskMasterTasksWatchers() {
    const entries = [...activeWatchers.values()];
    activeWatchers.clear();

    await Promise.all(entries.map(async (entry) => {
        if (entry.timer) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }
        try {
            await entry.watcher.close();
        } catch (error) {
            console.error('Failed to close TaskMaster tasks watcher:', error);
        }
    }));
}
