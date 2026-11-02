import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createShellRunner } from '../shell-exec.js';

const shell = createShellRunner();

test('captures stdout and a zero exit code, running in the given cwd', async () => {
  const result = await shell.exec({ cwd: '/tmp', command: 'echo hello && pwd' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'hello\n/tmp\n');
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, false);
});

test('a non-zero exit is a result, with stderr captured', async () => {
  const result = await shell.exec({ cwd: '/tmp', command: 'echo oops >&2; exit 3' });
  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, 'oops\n');
});

test('kills the command when the deadline passes', async () => {
  const startedAt = Date.now();
  const result = await shell.exec({ cwd: '/tmp', command: 'sleep 5', timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.ok(Date.now() - startedAt < 3000, 'returned well before the command would have finished');
});

test('caps output per stream and flags the cut', async () => {
  const result = await shell.exec({ cwd: '/tmp', command: 'head -c 5000 /dev/zero | tr "\\0" a', maxOutputBytes: 1000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 1000);
  assert.equal(result.truncated, true);
});

test('refuses a cwd that does not exist', async () => {
  await assert.rejects(shell.exec({ cwd: '/definitely/not/here', command: 'true' }), { status: 400, code: 'CWD_NOT_FOUND' });
});

test('a grandchild that leaves the process group and holds the pipes does not hang the call', async (t) => {
  // A distinctive duration plus an exact full-command match, so the cleanup
  // only kills the sleep this test leaves behind.
  const marker = 'sleep 30.0173';
  t.after(() => {
    spawnSync('pkill', ['-x', '-f', marker]);
  });
  const startedAt = Date.now();
  const result = await shell.exec({ cwd: '/tmp', command: `setsid ${marker} & echo started`, timeoutMs: 20_000 });
  assert.ok(Date.now() - startedAt < 2500, 'settled shortly after the shell exited');
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /started/);
});
