import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, activePreviewsDb } from '../modules/database/index.js';

// preview-runner touches the active_previews table on every lifecycle step,
// so the module (and the database singleton it imports) must first be pointed
// at an isolated DB. Dynamic import for the same reason auth.test.js uses one:
// a static import would be hoisted ahead of this setup.
let runner = null;
let tempDirectory = null;

async function setupIsolatedEnvironment() {
  if (runner) {
    return;
  }
  tempDirectory = await mkdtemp(path.join(tmpdir(), 'preview-runner-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'preview.db');
  await initializeDatabase();
  runner = await import('./preview-runner.js');
}

test.after(async () => {
  runner?.stopAllPreviews();
  closeConnection();
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

const LISTENING_COMMAND =
  `node -e "require('net').createServer(() => {}).listen(process.env.PORT, process.env.HOST, () => console.log('up'))"`;

const NEVER_LISTENS_COMMAND = `node -e "setInterval(() => {}, 1000)"`;

async function makeWorkDir(name) {
  const dir = path.join(tempDirectory, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

test('resolveBindHost never returns the wildcard address', async () => {
  await setupIsolatedEnvironment();
  const host = runner.resolveBindHost();
  assert.notEqual(host, '0.0.0.0');
  assert.match(host, /^\d+\.\d+\.\d+\.\d+$/);
});

test('startPreview reaches ready when the command listens on the injected port', async () => {
  await setupIsolatedEnvironment();
  const cwd = await makeWorkDir('happy');

  const status = await runner.startPreview({
    projectPath: cwd,
    cwd,
    command: LISTENING_COMMAND,
    bindHost: '127.0.0.1',
  });

  assert.equal(status.status, 'ready');
  assert.equal(status.url, `http://127.0.0.1:${status.port}`);
  assert.ok(Number.isInteger(status.port));

  const rows = activePreviewsDb.listAll().filter((row) => row.cwd === cwd);
  assert.equal(rows.length, 1);

  const stopped = runner.stopPreview(cwd);
  assert.equal(stopped.status, 'stopped');
  assert.equal(activePreviewsDb.listAll().filter((row) => row.cwd === cwd).length, 0);
});

test('starting an already-running preview returns the existing one', async () => {
  await setupIsolatedEnvironment();
  const cwd = await makeWorkDir('duplicate');

  const first = await runner.startPreview({
    projectPath: cwd,
    cwd,
    command: LISTENING_COMMAND,
    bindHost: '127.0.0.1',
  });
  const second = await runner.startPreview({
    projectPath: cwd,
    cwd,
    command: NEVER_LISTENS_COMMAND,
    bindHost: '127.0.0.1',
  });

  assert.equal(first.status, 'ready');
  assert.equal(second.port, first.port);

  runner.stopPreview(cwd);
});

test('startPreview fails with a log tail when nothing listens before the timeout', async () => {
  await setupIsolatedEnvironment();
  const cwd = await makeWorkDir('timeout');

  const status = await runner.startPreview({
    projectPath: cwd,
    cwd,
    command: NEVER_LISTENS_COMMAND,
    bindHost: '127.0.0.1',
    pollTimeoutMs: 1_500,
  });

  assert.equal(status.status, 'failed');
  assert.match(status.error, /Nothing listened/);
  assert.equal(activePreviewsDb.listAll().filter((row) => row.cwd === cwd).length, 0);
});

test('startPreview fails when the command exits before listening', async () => {
  await setupIsolatedEnvironment();
  const cwd = await makeWorkDir('crash');

  const status = await runner.startPreview({
    projectPath: cwd,
    cwd,
    command: `node -e "console.error('boom'); process.exit(3)"`,
    bindHost: '127.0.0.1',
    pollTimeoutMs: 5_000,
  });

  assert.equal(status.status, 'failed');
  assert.match(status.error, /exited with code 3/);
  assert.ok(status.logs.some((line) => line.includes('boom')));
});

test('startPreview runs the setup command first and surfaces its failure', async () => {
  await setupIsolatedEnvironment();
  const cwd = await makeWorkDir('setup-fail');

  const status = await runner.startPreview({
    projectPath: cwd,
    cwd,
    command: LISTENING_COMMAND,
    setupCommand: `node -e "console.error('no lockfile'); process.exit(1)"`,
    bindHost: '127.0.0.1',
  });

  assert.equal(status.status, 'failed');
  assert.match(status.error, /Setup failed/);
  assert.ok(status.logs.some((line) => line.includes('no lockfile')));
});

test('setup is skipped when node_modules already exists', async () => {
  await setupIsolatedEnvironment();
  const cwd = await makeWorkDir('setup-skip');
  await mkdir(path.join(cwd, 'node_modules'), { recursive: true });

  const status = await runner.startPreview({
    projectPath: cwd,
    cwd,
    command: LISTENING_COMMAND,
    setupCommand: `node -e "process.exit(1)"`,
    bindHost: '127.0.0.1',
  });

  assert.equal(status.status, 'ready');
  runner.stopPreview(cwd);
});

test('stop during the setup phase stops for good — the boot never resurrects', async () => {
  await setupIsolatedEnvironment();
  const cwd = await makeWorkDir('setup-stop');

  const bootPromise = runner.startPreview({
    projectPath: cwd,
    cwd,
    command: LISTENING_COMMAND,
    setupCommand: `node -e "setTimeout(() => {}, 30000)"`,
    bindHost: '127.0.0.1',
  });

  // Let it enter the installing phase, then stop mid-setup.
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(runner.getPreviewStatus(cwd).status, 'installing');
  runner.stopPreview(cwd);

  const finalStatus = await bootPromise;
  assert.equal(finalStatus.status, 'stopped');
  assert.equal(runner.getPreviewStatus(cwd).status, 'stopped');
});

test('a fixed port already in use fails fast instead of reporting a stranger as ready', async () => {
  await setupIsolatedEnvironment();
  const cwd = await makeWorkDir('port-taken');

  const { createServer } = await import('node:net');
  const occupant = createServer(() => {});
  await new Promise((resolve) => occupant.listen(0, '127.0.0.1', resolve));
  const takenPort = occupant.address().port;

  const status = await runner.startPreview({
    projectPath: cwd,
    cwd,
    command: LISTENING_COMMAND,
    bindHost: '127.0.0.1',
    port: takenPort,
  });

  assert.equal(status.status, 'failed');
  assert.match(status.error, /already in use/);

  await new Promise((resolve) => occupant.close(resolve));
});

test('isSamePreviewProcess matches only when /proc cmdline contains the command', async () => {
  await setupIsolatedEnvironment();
  const procRoot = path.join(tempDirectory, 'proc');
  await mkdir(path.join(procRoot, '4242'), { recursive: true });
  await writeFile(path.join(procRoot, '4242', 'cmdline'), ['node', 'my-dev-server', '--port', '5173'].join('\u0000'));

  assert.equal(runner.isSamePreviewProcess(4242, 'my-dev-server', procRoot), true);
  assert.equal(runner.isSamePreviewProcess(4242, 'other-command', procRoot), false);
  assert.equal(runner.isSamePreviewProcess(9999, 'my-dev-server', procRoot), false);
});

test('sweepOrphanPreviews kills matching orphans and drops recycled-pid rows', async () => {
  await setupIsolatedEnvironment();

  // A real orphan: detached child whose /proc cmdline matches its DB row.
  const orphan = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  const orphanCwd = path.join(tempDirectory, 'orphan-cwd');
  activePreviewsDb.record({
    cwd: orphanCwd,
    projectPath: orphanCwd,
    pid: orphan.pid,
    port: 1,
    command: 'sleep 30',
  });

  // A recycled PID: row's command does not match what the PID is running now.
  const survivor = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  const survivorCwd = path.join(tempDirectory, 'survivor-cwd');
  activePreviewsDb.record({
    cwd: survivorCwd,
    projectPath: survivorCwd,
    pid: survivor.pid,
    port: 2,
    command: 'totally-different-command',
  });

  runner.sweepOrphanPreviews();

  // Sweep clears every row either way.
  const cwds = activePreviewsDb.listAll().map((row) => row.cwd);
  assert.ok(!cwds.includes(orphanCwd));
  assert.ok(!cwds.includes(survivorCwd));

  // The matching orphan got SIGTERM; the mismatched PID was left alone.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(isProcessAlive(orphan.pid), false);
  assert.equal(isProcessAlive(survivor.pid), true);

  try {
    process.kill(-survivor.pid, 'SIGKILL');
  } catch {
    // best-effort cleanup
  }
});

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
