import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { spawnCursor } from './cursor-cli.js';
import { closeConnection, initializeDatabase } from './modules/database/index.js';
import { profilesService } from './modules/profiles/index.js';

const findEnvKey = (name) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

/**
 * Fake `cursor-agent` that records the environment it was spawned with into
 * PROFILE_ENV_CAPTURE and exits 0 so spawnCursor's close handler resolves.
 */
async function createFakeCursorAgent(binDir) {
  const scriptPath = path.join(binDir, 'cursor-agent.js');
  await writeFile(
    scriptPath,
    `
const capturePath = process.env.PROFILE_ENV_CAPTURE;
if (capturePath) {
  require('node:fs').writeFileSync(capturePath, JSON.stringify({ HOME: process.env.HOME ?? null }));
}
process.exit(0);
`,
    'utf8',
  );

  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, 'cursor-agent.cmd'),
      '@echo off\r\nnode "%~dp0cursor-agent.js" %*\r\n',
      'utf8',
    );
    return;
  }

  const commandPath = path.join(binDir, 'cursor-agent');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/cursor-agent.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

async function withCursorHarness(runTest) {
  const pathKey = findEnvKey('PATH');
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
    PROFILE_ENV_CAPTURE: process.env.PROFILE_ENV_CAPTURE,
    [pathKey]: process.env[pathKey],
  };
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'cursor-profile-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempRoot, 'profiles');
  process.env[pathKey] = `${tempRoot}${path.delimiter}${previous[pathKey] || ''}`;
  await initializeDatabase();
  await createFakeCursorAgent(tempRoot);

  const writer = { userId: null, sessionId: null, send() {}, setSessionId() {} };
  const readCapture = async (captureFile) =>
    JSON.parse(await readFile(captureFile, 'utf8'));

  try {
    await runTest({ tempRoot, writer, readCapture });
  } finally {
    closeConnection();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

// T8 Done-when: the cursor spawn receives the profile's HOME override.
test('spawnCursor injects the profile HOME into the cursor-agent process', async () => {
  await withCursorHarness(async ({ tempRoot, writer, readCapture }) => {
    const profile = profilesService.createProfile({ provider: 'cursor', name: 'Account A' });
    const capture = path.join(tempRoot, 'cursor-env.json');
    process.env.PROFILE_ENV_CAPTURE = capture;

    await spawnCursor('hello', { cwd: tempRoot, profileId: profile.id }, writer);

    const env = await readCapture(capture);
    assert.equal(env.HOME, path.join(tempRoot, 'profiles', 'cursor', profile.slug));
  });
});

// T8 Done-when: retrocompat — no profile leaves HOME as the host's own.
test('spawnCursor without a profile leaves HOME as the host value', async () => {
  await withCursorHarness(async ({ tempRoot, writer, readCapture }) => {
    const capture = path.join(tempRoot, 'cursor-env-default.json');
    process.env.PROFILE_ENV_CAPTURE = capture;

    await spawnCursor('hello', { cwd: tempRoot }, writer);

    const env = await readCapture(capture);
    assert.equal(env.HOME, process.env.HOME ?? null);
  });
});

// T8 AC4: two cursor profiles never share a HOME (no credential leak).
test('two cursor profiles resolve to distinct HOME directories', async () => {
  await withCursorHarness(async ({ tempRoot, writer, readCapture }) => {
    const a = profilesService.createProfile({ provider: 'cursor', name: 'A' });
    const b = profilesService.createProfile({ provider: 'cursor', name: 'B' });

    const captureA = path.join(tempRoot, 'a.json');
    process.env.PROFILE_ENV_CAPTURE = captureA;
    await spawnCursor('hi', { cwd: tempRoot, profileId: a.id }, writer);

    const captureB = path.join(tempRoot, 'b.json');
    process.env.PROFILE_ENV_CAPTURE = captureB;
    await spawnCursor('hi', { cwd: tempRoot, profileId: b.id }, writer);

    const envA = await readCapture(captureA);
    const envB = await readCapture(captureB);
    assert.notEqual(envA.HOME, envB.HOME);
  });
});
