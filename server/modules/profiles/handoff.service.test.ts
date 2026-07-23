import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { profilesService } from '@/modules/profiles/profiles.service.js';
import { resolveProfileDir } from '@/modules/profiles/profile-env.js';
import {
  drainPendingSwitch,
  switchSessionProfile,
} from '@/modules/profiles/handoff.service.js';
import { AppError } from '@/shared/utils.js';

/** Boots an isolated DB + profiles root in a temp dir for one test. */
async function withHandoffEnvironment(
  runTest: (profilesRoot: string) => void | Promise<void>,
): Promise<void> {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
  };
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'handoff-'));
  const profilesRoot = path.join(tempDirectory, 'profiles');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = profilesRoot;
  await initializeDatabase();

  try {
    await runTest(profilesRoot);
  } finally {
    closeConnection();
    if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    if (previous.PROFILES_ROOT === undefined) delete process.env.PROFILES_ROOT;
    else process.env.PROFILES_ROOT = previous.PROFILES_ROOT;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const ENC = 'proj-x';
const TRANSCRIPT = '{"type":"user","text":"hello"}\n{"type":"assistant","text":"hi there"}\n';

/**
 * Registers a session owned by `ownerId` with a real transcript file laid out
 * under that profile's `projects/<enc>/<id>.jsonl` store path (the layout the
 * Claude CLI resumes from).
 */
function seedTransplantableSession(
  ownerSlug: string,
  ownerId: string,
  sessionId: string,
): string {
  const sourceDir = path.join(resolveProfileDir('claude', ownerSlug), 'projects', ENC);
  fs.mkdirSync(sourceDir, { recursive: true });
  const sourceFile = path.join(sourceDir, `${sessionId}.jsonl`);
  fs.writeFileSync(sourceFile, TRANSCRIPT);
  sessionsDb.createSession(sessionId, 'claude', '/tmp/handoff-proj', 'S', undefined, undefined, sourceFile, ownerId);
  return sourceFile;
}

function targetTransplantPath(targetSlug: string, sessionId: string): string {
  return path.join(resolveProfileDir('claude', targetSlug), 'projects', ENC, `${sessionId}.jsonl`);
}

test('transplant preserves history, marks the switch point, and repoints profile_id (AC1/AC3)', async () => {
  await withHandoffEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Account A' });
    const target = profilesService.createProfile({ provider: 'claude', name: 'Account B' });
    const sessionId = 'sess-transplant';
    seedTransplantableSession(source.slug, source.id, sessionId);

    const result = switchSessionProfile(sessionId, target.id, { isSessionRunning: () => false });

    assert.equal(result.status, 'transplanted');
    assert.equal(result.profileId, target.id);
    assert.equal(result.sessionId, sessionId);

    const transplanted = targetTransplantPath(target.slug, sessionId);
    assert.ok(fs.existsSync(transplanted), 'transcript copied into target profile dir');
    const lines = fs.readFileSync(transplanted, 'utf8').split(/\r?\n/).filter(Boolean);
    // AC1: the original history lines are preserved verbatim under the new profile.
    assert.ok(lines.some((line) => line === '{"type":"user","text":"hello"}'));
    assert.ok(lines.some((line) => line === '{"type":"assistant","text":"hi there"}'));

    // AC3: a switch marker naming the new profile is appended at the switch point.
    const markerLine = lines.find((line) => line.includes('"type":"profile-switch"'));
    assert.ok(markerLine, 'switch marker recorded in the transcript');
    const marker = JSON.parse(markerLine as string);
    assert.equal(marker.fromProfileId, source.id);
    assert.equal(marker.toProfileId, target.id);
    assert.equal(marker.toProfileName, target.name);
    assert.equal(marker.note, `Account switched to "${target.name}"`);

    // AC3: the session row now points at the target profile.
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, target.id);
  });
});

test('degrades to a seeded session when the provider is not transplantable (AC2)', async () => {
  await withHandoffEnvironment(async (profilesRoot) => {
    const source = profilesService.createProfile({ provider: 'cursor', name: 'Cursor A' });
    const target = profilesService.createProfile({ provider: 'cursor', name: 'Cursor B' });
    const sessionId = 'sess-cursor';

    const priorFile = path.join(profilesRoot, 'prior-cursor.jsonl');
    fs.writeFileSync(priorFile, 'PRIOR-CONTEXT-LINE\n');
    sessionsDb.createSession(sessionId, 'cursor', '/tmp/handoff-cursor', 'SC', undefined, undefined, priorFile, source.id);

    const result = switchSessionProfile(sessionId, target.id, { isSessionRunning: () => false });

    assert.equal(result.status, 'seeded');
    assert.ok(result.seededSessionId);
    assert.notEqual(result.seededSessionId, sessionId);
    assert.equal(result.profileId, target.id);

    const seededRow = sessionsDb.getSessionById(result.seededSessionId as string);
    assert.equal(seededRow?.profile_id, target.id, 'seeded session bound to target profile');
    assert.ok(seededRow?.jsonl_path, 'seeded session has a transcript path');
    const seedContent = fs.readFileSync(seededRow!.jsonl_path as string, 'utf8');
    assert.ok(seedContent.includes('PRIOR-CONTEXT-LINE'), 'seeded with the prior context');
    assert.ok(seedContent.includes('"type":"profile-switch"'), 'seed records the switch marker');

    // Never a silent failure: the original session is left untouched.
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, source.id);
  });
});

test('degrades to a seeded session when a supported provider transcript is missing (AC2)', async () => {
  await withHandoffEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'claude', name: 'Claude B' });
    const sessionId = 'sess-missing';
    // jsonl_path recorded but the file does not exist on disk → primary path unavailable.
    sessionsDb.createSession(
      sessionId,
      'claude',
      '/tmp/handoff-missing',
      'SM',
      undefined,
      undefined,
      '/nonexistent/projects/x/sess-missing.jsonl',
      source.id,
    );

    const result = switchSessionProfile(sessionId, target.id, { isSessionRunning: () => false });

    assert.equal(result.status, 'seeded');
    assert.equal(sessionsDb.getSessionById(result.seededSessionId as string)?.profile_id, target.id);
  });
});

test('queues the switch while a turn is running, then applies it on turn end (edge case)', async () => {
  await withHandoffEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Account A' });
    const target = profilesService.createProfile({ provider: 'claude', name: 'Account B' });
    const sessionId = 'sess-running';
    seedTransplantableSession(source.slug, source.id, sessionId);

    const queued = switchSessionProfile(sessionId, target.id, { isSessionRunning: () => true });

    assert.equal(queued.status, 'queued');
    // The running turn is not killed and nothing is applied yet.
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, source.id);
    assert.ok(!fs.existsSync(targetTransplantPath(target.slug, sessionId)), 'no transplant mid-turn');

    // Turn ends: the queued switch is drained and applied.
    const applied = drainPendingSwitch(sessionId);
    assert.equal(applied?.status, 'transplanted');
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, target.id);
    assert.ok(fs.existsSync(targetTransplantPath(target.slug, sessionId)));

    // Draining again is a no-op (queue cleared).
    assert.equal(drainPendingSwitch(sessionId), null);
  });
});

test('rejects a handoff for an unknown session', async () => {
  await withHandoffEnvironment(async () => {
    const target = profilesService.createProfile({ provider: 'claude', name: 'Account B' });
    assert.throws(
      () => switchSessionProfile('does-not-exist', target.id, { isSessionRunning: () => false }),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 404 && error.code === 'SESSION_NOT_FOUND',
    );
  });
});

test('rejects a handoff to a profile of a different provider', async () => {
  await withHandoffEnvironment(async () => {
    const claudeProfile = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const codexProfile = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    const sessionId = 'sess-mismatch';
    seedTransplantableSession(claudeProfile.slug, claudeProfile.id, sessionId);

    assert.throws(
      () => switchSessionProfile(sessionId, codexProfile.id, { isSessionRunning: () => false }),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 400 &&
        error.code === 'HANDOFF_PROVIDER_MISMATCH',
    );
  });
});

test('rejects a no-op handoff to the profile already in use', async () => {
  await withHandoffEnvironment(async () => {
    const owner = profilesService.createProfile({ provider: 'claude', name: 'Account A' });
    const sessionId = 'sess-noop';
    seedTransplantableSession(owner.slug, owner.id, sessionId);

    assert.throws(
      () => switchSessionProfile(sessionId, owner.id, { isSessionRunning: () => false }),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 400 && error.code === 'HANDOFF_NO_OP',
    );
  });
});
