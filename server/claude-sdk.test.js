import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { mapCliOptionsToSDK } from './claude-sdk.js';
import { closeConnection, initializeDatabase } from './modules/database/index.js';
import { profilesService } from './modules/profiles/index.js';

/**
 * Runs a test against an ephemeral DB + PROFILES_ROOT, with any ambient
 * CLAUDE_CONFIG_DIR removed so the retrocompat assertion is unambiguous.
 */
async function withProfilesEnvironment(runTest) {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  };
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-sdk-profile-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempDirectory, 'profiles');
  delete process.env.CLAUDE_CONFIG_DIR;
  await initializeDatabase();

  try {
    await runTest(path.join(tempDirectory, 'profiles'));
  } finally {
    closeConnection();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

// T6 Done-when: a session built with a profile receives the right CLAUDE_CONFIG_DIR.
test('mapCliOptionsToSDK injects the profile CLAUDE_CONFIG_DIR into the SDK env', async () => {
  await withProfilesEnvironment((profilesRoot) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Account A' });

    const sdkOptions = mapCliOptionsToSDK({ profileId: profile.id });

    assert.equal(
      sdkOptions.env.CLAUDE_CONFIG_DIR,
      path.join(profilesRoot, 'claude', profile.slug),
    );
    // The host environment must survive the merge — the Agent SDK replaces
    // process.env with options.env, so dropping PATH would break the CLI.
    assert.equal(sdkOptions.env.PATH, process.env.PATH);
  });
});

test('ephemeral options disable tools, session persistence and resume', async () => {
  await withProfilesEnvironment(() => {
    const sdkOptions = mapCliOptionsToSDK({ ephemeral: true, sessionId: 'session-1' });

    assert.deepEqual(sdkOptions.tools, []);
    assert.equal(sdkOptions.persistSession, false);
    assert.equal(sdkOptions.resume, undefined);
    assert.deepEqual(sdkOptions.allowedTools, []);
  });
});

test('a normal run keeps the tool preset and resumes its session', async () => {
  await withProfilesEnvironment(() => {
    const sdkOptions = mapCliOptionsToSDK({ sessionId: 'session-1' });

    assert.deepEqual(sdkOptions.tools, { type: 'preset', preset: 'claude_code' });
    assert.equal(sdkOptions.persistSession, undefined);
    assert.equal(sdkOptions.resume, 'session-1');
  });
});

// T6 Done-when: with no profile, behavior is byte-for-byte upstream (no injection).
test('mapCliOptionsToSDK leaves CLAUDE_CONFIG_DIR untouched without a profile', async () => {
  await withProfilesEnvironment(() => {
    const sdkOptions = mapCliOptionsToSDK({});
    assert.equal(sdkOptions.env.CLAUDE_CONFIG_DIR, undefined);
  });
});

test('the stream close timeout rides on the SDK env instead of this process', async () => {
  await withProfilesEnvironment(() => {
    // options.env replaces process.env for the CLI subprocess, so a value set
    // on this process would never reach it — and mutating the shared process
    // environment around a query construction races concurrent runs.
    const before = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    const sdkOptions = mapCliOptionsToSDK({});

    assert.equal(sdkOptions.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT, '300000');
    assert.equal(process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT, before);
  });
});

test('an operator-set stream close timeout is left alone', async () => {
  await withProfilesEnvironment(() => {
    const previous = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '90000';

    try {
      assert.equal(mapCliOptionsToSDK({}).env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT, '90000');
    } finally {
      if (previous === undefined) {
        delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
      } else {
        process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = previous;
      }
    }
  });
});

test('concurrent option builds each get their own timeout, unaffected by the others', async () => {
  await withProfilesEnvironment(async () => {
    // Two runs starting at the same moment used to race over a shared
    // process.env entry: one restoring it landed inside the other's window and
    // left that query on the SDK default.
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => mapCliOptionsToSDK({ sessionId: 'a' })),
      Promise.resolve().then(() => mapCliOptionsToSDK({ sessionId: 'b' })),
    ]);

    assert.equal(first.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT, '300000');
    assert.equal(second.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT, '300000');
  });
});
