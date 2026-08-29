import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { activePreviewsDb } from '../modules/database/index.js';

/*
 * Preview runner — boots a project's dev server for hands-on UAT and hands
 * back a tailnet-reachable URL.
 *
 *   start(config) ──▶ [setup?] ──▶ spawn ──▶ poll port ──▶ ready (url)
 *        │               │           │           │
 *        ▼               ▼           ▼           ▼
 *    one per cwd    setup failed  spawn/exit  timeout ──▶ failed (+log tail)
 *                                 = failed
 *   stop(cwd) kills the whole process group; a boot sweep kills processes a
 *   previous server instance left behind (verified against /proc cmdline).
 */

/** Preview state machine: installing → starting → ready → stopped | failed */
const previews = new Map(); // Map<cwd, PreviewState>

const MAX_LOG_LINES = 200;
const PORT_POLL_INTERVAL_MS = 300;
const PORT_POLL_TIMEOUT_MS = 60_000;
const SETUP_TIMEOUT_MS = 10 * 60_000;
const KILL_GRACE_MS = 3_000;

/** Tailscale hands out CGNAT addresses (100.64.0.0/10). */
function isTailnetIp(address) {
  const octets = address.split('.').map(Number);
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function isPrivateLanIp(address) {
  const octets = address.split('.').map(Number);
  if (octets[0] === 10) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return false;
}

/**
 * Where the preview binds. Never 0.0.0.0 — the host has a public interface
 * and previews carry no auth; the tailnet (or LAN) boundary IS the auth.
 */
export function resolveBindHost() {
  const candidates = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);

  return (
    candidates.find(isTailnetIp) ??
    candidates.find(isPrivateLanIp) ??
    '127.0.0.1'
  );
}

function allocateFreePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function probePort(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1_000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', fail);
    socket.once('timeout', fail);
  });
}

function appendLog(state, chunk) {
  const lines = chunk.toString().split('\n').filter((line) => line.trim() !== '');
  state.logs.push(...lines);
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
  }
}

function snapshot(state) {
  if (!state) {
    return { status: 'stopped', logs: [] };
  }
  return {
    status: state.status,
    phase: state.phase,
    cwd: state.cwd,
    projectPath: state.projectPath,
    port: state.port,
    host: state.host,
    url: state.status === 'ready' ? `http://${state.host}:${state.port}` : null,
    error: state.error ?? null,
    startedAt: state.startedAt,
    logs: [...state.logs],
  };
}

function substitutePlaceholders(command, { port, host }) {
  return command.replaceAll('$PORT', String(port)).replaceAll('$HOST', host);
}

function runSetup(state, setupCommand) {
  return new Promise((resolve, reject) => {
    const child = spawn(setupCommand, {
      cwd: state.cwd,
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Tracked so stopPreview can kill a long `npm install` mid-flight.
    state.process = child;

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Setup command timed out after ${SETUP_TIMEOUT_MS / 60000} minutes`));
    }, SETUP_TIMEOUT_MS);

    child.stdout.on('data', (data) => appendLog(state, data));
    child.stderr.on('data', (data) => appendLog(state, data));
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Setup command exited with code ${code}`));
      }
    });
  });
}

async function pollUntilListening(state, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (state.status === 'failed' || state.status === 'stopped') {
      return false;
    }
    if (await probePort(state.host, state.port)) {
      return true;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, PORT_POLL_INTERVAL_MS));
  }
  return false;
}

function killProcessGroup(pid) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }, KILL_GRACE_MS).unref();
}

function markFailed(state, message) {
  state.status = 'failed';
  state.error = message;
  activePreviewsDb.deleteByCwd(state.cwd);
}

/**
 * Boot (or return the already-running) preview for a working directory.
 * Resolves once the state machine leaves the boot phases — check
 * `snapshot.status` for the outcome; this never rejects.
 */
export async function startPreview({
  projectPath,
  cwd,
  command,
  setupCommand,
  bindHost,
  port,
  pollTimeoutMs = PORT_POLL_TIMEOUT_MS,
}) {
  const workingDir = cwd || projectPath;
  const existing = previews.get(workingDir);
  if (existing && ['installing', 'starting', 'ready'].includes(existing.status)) {
    return snapshot(existing);
  }

  const state = {
    cwd: workingDir,
    projectPath,
    status: 'installing',
    phase: 'setup',
    port: null,
    host: null,
    error: null,
    logs: [],
    process: null,
    startedAt: new Date().toISOString(),
  };
  previews.set(workingDir, state);

  try {
    state.host = bindHost || resolveBindHost();
    if (port) {
      // A fixed port already in use would make the poll report someone
      // else's app as "ready" — fail fast instead.
      if (await probePort(state.host, port)) {
        markFailed(state, `Port ${port} on ${state.host} is already in use`);
        return snapshot(state);
      }
      state.port = port;
    } else {
      state.port = await allocateFreePort(state.host);
    }
  } catch (err) {
    markFailed(state, `Could not allocate a port on ${state.host}: ${err.message}`);
    return snapshot(state);
  }

  const needsSetup =
    Boolean(setupCommand?.trim()) && !existsSync(path.join(workingDir, 'node_modules'));

  if (needsSetup) {
    try {
      await runSetup(state, setupCommand);
    } catch (err) {
      if (!state.stopRequested) {
        markFailed(state, `Setup failed: ${err.message}`);
      }
      return snapshot(state);
    }
    state.process = null;
  }

  // The user may have hit Stop while setup was running.
  if (state.stopRequested) {
    state.status = 'stopped';
    return snapshot(state);
  }

  state.status = 'starting';
  state.phase = 'boot';

  const resolvedCommand = substitutePlaceholders(command, { port: state.port, host: state.host });
  const child = spawn(resolvedCommand, {
    cwd: workingDir,
    shell: true,
    // Own process group so stop() can kill the whole tree (npm → node → …).
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(state.port),
      HOST: state.host,
    },
  });

  state.process = child;
  state.resolvedCommand = resolvedCommand;

  child.stdout.on('data', (data) => appendLog(state, data));
  child.stderr.on('data', (data) => appendLog(state, data));
  child.on('error', (err) => {
    markFailed(state, `Failed to spawn: ${err.message}`);
  });
  child.on('exit', (code) => {
    activePreviewsDb.deleteByCwd(workingDir);
    if (state.status === 'ready' || state.status === 'starting') {
      state.status = state.stopRequested ? 'stopped' : 'failed';
      if (state.status === 'failed') {
        state.error = `Process exited with code ${code}`;
      }
    }
  });

  if (child.pid) {
    activePreviewsDb.record({
      cwd: workingDir,
      projectPath,
      pid: child.pid,
      port: state.port,
      command: resolvedCommand,
    });
  }

  const listening = await pollUntilListening(state, pollTimeoutMs);
  if (listening) {
    state.status = 'ready';
  } else if (state.status === 'starting') {
    markFailed(state, `Nothing listened on ${state.host}:${state.port} within ${pollTimeoutMs / 1000}s`);
    if (child.pid) {
      killProcessGroup(child.pid);
    }
  }

  return snapshot(state);
}

export function getPreviewStatus(cwd) {
  return snapshot(previews.get(cwd));
}

export function stopPreview(cwd) {
  const state = previews.get(cwd);
  if (!state) {
    return { status: 'stopped', logs: [] };
  }

  state.stopRequested = true;
  if (state.process?.pid) {
    killProcessGroup(state.process.pid);
  }
  state.status = 'stopped';
  activePreviewsDb.deleteByCwd(cwd);
  return snapshot(state);
}

/** True when /proc says the PID is still running the command we spawned. */
export function isSamePreviewProcess(pid, command, procRoot = '/proc') {
  try {
    const cmdline = readFileSync(path.join(procRoot, String(pid), 'cmdline'), 'utf8');
    return cmdline.replaceAll('\0', ' ').includes(command);
  } catch {
    return false;
  }
}

/**
 * Kill previews a previous server instance left running. PIDs recycle, so a
 * row whose /proc cmdline no longer matches is dropped without killing.
 */
export function sweepOrphanPreviews({ procRoot = '/proc' } = {}) {
  for (const row of activePreviewsDb.listAll()) {
    if (isSamePreviewProcess(row.pid, row.command, procRoot)) {
      console.log(`[Preview] Killing orphan preview pid=${row.pid} (${row.cwd})`);
      killProcessGroup(row.pid);
    }
    activePreviewsDb.deleteByCwd(row.cwd);
  }
}

export function stopAllPreviews() {
  for (const cwd of [...previews.keys()]) {
    stopPreview(cwd);
  }
}
