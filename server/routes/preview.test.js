import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectPreviewCommand } from './preview.js';

let tempDirectory = null;

test.before(async () => {
  tempDirectory = await mkdtemp(path.join(tmpdir(), 'preview-detect-'));
});

test.after(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

async function makeProject(name, packageJson) {
  const dir = path.join(tempDirectory, name);
  await mkdir(dir, { recursive: true });
  if (packageJson !== undefined) {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(packageJson));
  }
  return dir;
}

test('detects a vite project and injects host/port flags', async () => {
  const dir = await makeProject('vite-app', {
    scripts: { dev: 'vite' },
    devDependencies: { vite: '^5.0.0' },
  });

  assert.deepEqual(detectPreviewCommand(dir), {
    command: 'npm run dev -- --host $HOST --port $PORT',
    setupCommand: 'npm install',
  });
});

test('detects a next project and injects -H/-p flags', async () => {
  const dir = await makeProject('next-app', {
    scripts: { dev: 'next dev' },
    dependencies: { next: '^15.0.0' },
  });

  assert.deepEqual(detectPreviewCommand(dir), {
    command: 'npm run dev -- -H $HOST -p $PORT',
    setupCommand: 'npm install',
  });
});

test('falls back to the start script with env-only injection', async () => {
  const dir = await makeProject('plain-app', {
    scripts: { start: 'node server.js' },
    dependencies: { express: '^4.0.0' },
  });

  assert.deepEqual(detectPreviewCommand(dir), {
    command: 'npm run start',
    setupCommand: 'npm install',
  });
});

test('returns null when there is no usable script or no package.json', async () => {
  const noScripts = await makeProject('no-scripts', { name: 'x' });
  const noPackage = await makeProject('no-package');

  assert.equal(detectPreviewCommand(noScripts), null);
  assert.equal(detectPreviewCommand(noPackage), null);
});
