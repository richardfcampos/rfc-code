import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  sessionLegsDb,
  sessionsDb,
} from '@/modules/database/index.js';
import { profilesService, type ProfileView } from '@/modules/profiles/profiles.service.js';
import { resolveCredentialPath, resolveProfileDir } from '@/modules/profiles/profile-env.js';
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

/** Drops the credential artifact that marks a profile as signed in. */
function authenticate(profile: ProfileView): void {
  const credentialPath = resolveCredentialPath(
    profile.provider,
    resolveProfileDir(profile.provider, profile.slug),
  );
  fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
  fs.writeFileSync(credentialPath, '{}');
}

const HISTORY = [
  { kind: 'text', role: 'user', content: 'port the parser to rust' },
  { kind: 'text', role: 'assistant', content: 'started with the lexer' },
];

test('transplant preserves history, marks the switch point, and repoints profile_id (AC1/AC3)', async () => {
  await withHandoffEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Account A' });
    const target = profilesService.createProfile({ provider: 'claude', name: 'Account B' });
    const sessionId = 'sess-transplant';
    seedTransplantableSession(source.slug, source.id, sessionId);

    const result = await switchSessionProfile(sessionId, target.id, { isSessionRunning: () => false });

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

    const result = await switchSessionProfile(sessionId, target.id, { isSessionRunning: () => false });

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

    const result = await switchSessionProfile(sessionId, target.id, { isSessionRunning: () => false });

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

    const queued = await switchSessionProfile(sessionId, target.id, { isSessionRunning: () => true });

    assert.equal(queued.status, 'queued');
    // The running turn is not killed and nothing is applied yet.
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, source.id);
    assert.ok(!fs.existsSync(targetTransplantPath(target.slug, sessionId)), 'no transplant mid-turn');

    // Turn ends: the queued switch is drained and applied.
    const applied = await drainPendingSwitch(sessionId);
    assert.equal(applied?.status, 'transplanted');
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, target.id);
    assert.ok(fs.existsSync(targetTransplantPath(target.slug, sessionId)));

    // Draining again is a no-op (queue cleared).
    assert.equal(await drainPendingSwitch(sessionId), null);
  });
});

test('rejects a handoff for an unknown session', async () => {
  await withHandoffEnvironment(async () => {
    const target = profilesService.createProfile({ provider: 'claude', name: 'Account B' });
    await assert.rejects(
      switchSessionProfile('does-not-exist', target.id, { isSessionRunning: () => false }),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 404 && error.code === 'SESSION_NOT_FOUND',
    );
  });
});

test('hands a session to another provider on a primed leg, keeping the session id', async () => {
  await withHandoffEnvironment(async () => {
    const claudeProfile = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const codexProfile = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(codexProfile);
    const sessionId = 'sess-cross';
    const sourceTranscript = seedTransplantableSession(
      claudeProfile.slug,
      claudeProfile.id,
      sessionId,
    );

    const result = await switchSessionProfile(sessionId, codexProfile.id, {
      isSessionRunning: () => false,
      loadHistory: async () => HISTORY,
    });

    assert.equal(result.status, 'leg-opened');
    assert.equal(result.primed, true);
    // The app-facing id survives the switch, so open tabs and links keep working.
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.seededSessionId, undefined, 'no sibling session is created');

    const row = sessionsDb.getSessionById(sessionId);
    assert.equal(row?.provider, 'codex', 'the session now runs on the target provider');
    assert.equal(row?.profile_id, codexProfile.id);
    // A fresh leg has no native transcript until the CLI announces its own id.
    assert.equal(row?.provider_session_id, null);
    assert.equal(row?.jsonl_path, null);
    assert.ok(row?.seed_primer_path, 'primer pointer recorded');
    assert.ok(fs.existsSync(row!.seed_primer_path as string), 'primer written to disk');
    assert.ok(
      fs.readFileSync(row!.seed_primer_path as string, 'utf8').includes('port the parser to rust'),
      'primer carries the prior conversation',
    );

    const legs = sessionLegsDb.listLegs(sessionId);
    assert.equal(legs.length, 1);
    assert.equal(legs[0]?.provider, 'codex');
    assert.equal(legs[0]?.profile_id, codexProfile.id);
    assert.equal(legs[0]?.ended_at, null, 'the target leg is the active one');

    // The source provider's own transcript is left where it was recorded.
    assert.ok(fs.existsSync(sourceTranscript));
    assert.equal(fs.readFileSync(sourceTranscript, 'utf8'), TRANSCRIPT);
  });
});

test('resumes the leg a provider already owns instead of opening a third one', async () => {
  await withHandoffEnvironment(async () => {
    const claudeProfile = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const codexProfile = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(claudeProfile);
    authenticate(codexProfile);
    const sessionId = 'sess-cross-return';
    seedTransplantableSession(claudeProfile.slug, claudeProfile.id, sessionId);

    const deps = { isSessionRunning: () => false, loadHistory: async () => HISTORY };
    await switchSessionProfile(sessionId, codexProfile.id, deps);
    await switchSessionProfile(sessionId, claudeProfile.id, deps);
    const back = await switchSessionProfile(sessionId, codexProfile.id, deps);

    assert.equal(back.status, 'leg-resumed');
    assert.equal(back.sessionId, sessionId);
    assert.equal(back.seededSessionId, undefined);
    assert.equal(sessionLegsDb.listLegs(sessionId).length, 2, 'the codex leg was reused');
    assert.equal(sessionsDb.getSessionById(sessionId)?.profile_id, codexProfile.id);
  });
});

test('applies a queued cross-provider switch once the running turn ends', async () => {
  await withHandoffEnvironment(async () => {
    const claudeProfile = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const codexProfile = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(codexProfile);
    const sessionId = 'sess-cross-queued';
    seedTransplantableSession(claudeProfile.slug, claudeProfile.id, sessionId);

    const queued = await switchSessionProfile(sessionId, codexProfile.id, {
      isSessionRunning: () => true,
    });
    assert.equal(queued.status, 'queued');
    assert.equal(sessionsDb.getSessionById(sessionId)?.provider, 'claude', 'nothing moves mid-turn');

    const applied = await drainPendingSwitch(sessionId, { loadHistory: async () => HISTORY });
    assert.equal(applied?.status, 'leg-opened');
    assert.equal(applied?.primed, true);
    assert.equal(applied?.sessionId, sessionId);
    assert.equal(sessionsDb.getSessionById(sessionId)?.provider, 'codex');
  });
});

test('rejects a no-op handoff to the profile already in use', async () => {
  await withHandoffEnvironment(async () => {
    const owner = profilesService.createProfile({ provider: 'claude', name: 'Account A' });
    const sessionId = 'sess-noop';
    seedTransplantableSession(owner.slug, owner.id, sessionId);

    await assert.rejects(
      switchSessionProfile(sessionId, owner.id, { isSessionRunning: () => false }),
      (error: unknown) =>
        error instanceof AppError && error.statusCode === 400 && error.code === 'HANDOFF_NO_OP',
    );
  });
});
