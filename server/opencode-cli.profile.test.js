import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { spawnOpenCode } from './opencode-cli.js';
import { closeConnection, initializeDatabase } from './modules/database/index.js';
import { profilesService } from './modules/profiles/index.js';

const findEnvKey = (name) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

/**
 * Fake `opencode` that records the XDG env it was spawned with, then emits the
 * minimal event stream so spawnOpenCode completes and resolves.
 */
async function createFakeOpenCode(binDir) {
  const scriptPath = path.join(binDir, 'opencode.js');
  await writeFile(
    scriptPath,
    `
const capturePath = process.env.PROFILE_ENV_CAPTURE;
if (capturePath) {
  require('node:fs').writeFileSync(capturePath, JSON.stringify({
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? null,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? null,
  }));
}
for (const event of [
  { type: 'text', sessionID: 'open-live-1', text: 'ok' },
  { type: 'step_finish', sessionID: 'open-live-1' },
]) {
  console.log(JSON.stringify(event));
}
`,
    'utf8',
  );

  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, 'opencode.cmd'),
      '@echo off\r\nnode "%~dp0opencode.js" %*\r\n',
      'utf8',
    );
    return;
  }

  const commandPath = path.join(binDir, 'opencode');
  await writeFile(commandPath, '#!/bin/sh\nnode "$(dirname "$0")/opencode.js" "$@"\n', 'utf8');
  await chmod(commandPath, 0o755);
}

async function withOpenCodeHarness(runTest) {
  const pathKey = findEnvKey('PATH');
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
    PROFILE_ENV_CAPTURE: process.env.PROFILE_ENV_CAPTURE,
    [pathKey]: process.env[pathKey],
  };
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'opencode-profile-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempRoot, 'profiles');
  process.env[pathKey] = `${tempRoot}${path.delimiter}${previous[pathKey] || ''}`;
  await initializeDatabase();
  await createFakeOpenCode(tempRoot);

  const writer = { userId: null, sessionId: null, send() {}, setSessionId() {} };
  const readCapture = async (captureFile) => JSON.parse(await readFile(captureFile, 'utf8'));

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

// T8 Done-when: the opencode spawn receives the profile's XDG config/data dirs.
test('spawnOpenCode injects the profile XDG dirs into the opencode process', async () => {
  await withOpenCodeHarness(async ({ tempRoot, writer, readCapture }) => {
    const profile = profilesService.createProfile({ provider: 'opencode', name: 'Account A' });
    const capture = path.join(tempRoot, 'opencode-env.json');
    process.env.PROFILE_ENV_CAPTURE = capture;

    await spawnOpenCode('hello', { cwd: tempRoot, profileId: profile.id }, writer);

    const env = await readCapture(capture);
    const profileDir = path.join(tempRoot, 'profiles', 'opencode', profile.slug);
    assert.equal(env.XDG_CONFIG_HOME, path.join(profileDir, 'config'));
    assert.equal(env.XDG_DATA_HOME, path.join(profileDir, 'data'));
  });
});

// T8 Done-when: retrocompat — no profile keeps the host's own XDG values.
test('spawnOpenCode without a profile keeps the host XDG values', async () => {
  await withOpenCodeHarness(async ({ tempRoot, writer, readCapture }) => {
    const capture = path.join(tempRoot, 'opencode-env-default.json');
    process.env.PROFILE_ENV_CAPTURE = capture;

    await spawnOpenCode('hello', { cwd: tempRoot }, writer);

    const env = await readCapture(capture);
    assert.equal(env.XDG_CONFIG_HOME, process.env.XDG_CONFIG_HOME ?? null);
  });
});

// T8 AC4: two opencode profiles never share XDG dirs (no credential leak).
test('two opencode profiles resolve to distinct XDG data dirs', async () => {
  await withOpenCodeHarness(async ({ tempRoot, writer, readCapture }) => {
    const a = profilesService.createProfile({ provider: 'opencode', name: 'A' });
    const b = profilesService.createProfile({ provider: 'opencode', name: 'B' });

    const captureA = path.join(tempRoot, 'a.json');
    process.env.PROFILE_ENV_CAPTURE = captureA;
    await spawnOpenCode('hi', { cwd: tempRoot, profileId: a.id }, writer);

    const captureB = path.join(tempRoot, 'b.json');
    process.env.PROFILE_ENV_CAPTURE = captureB;
    await spawnOpenCode('hi', { cwd: tempRoot, profileId: b.id }, writer);

    const envA = await readCapture(captureA);
    const envB = await readCapture(captureB);
    assert.notEqual(envA.XDG_DATA_HOME, envB.XDG_DATA_HOME);
  });
});
