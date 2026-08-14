import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  sessionLegsDb,
  sessionsDb,
  type LegRow,
  type SessionRow,
} from '@/modules/database/index.js';
import { profilesService, type ProfileView } from '@/modules/profiles/profiles.service.js';
import { resolveCredentialPath, resolveProfileDir } from '@/modules/profiles/profile-env.js';
import {
  applyCrossProviderSwitch,
  resolveLegPrimerPath,
} from '@/modules/profiles/handoff-leg.js';
import type { PrimerMessage } from '@/modules/profiles/handoff-primer.js';
import { AppError } from '@/shared/utils.js';

/** Boots an isolated DB + profiles root in a temp dir for one test. */
async function withLegEnvironment(
  runTest: (tempDirectory: string) => Promise<void>,
): Promise<void> {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
  };
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'handoff-leg-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempDirectory, 'profiles');
  await initializeDatabase();

  try {
    await runTest(tempDirectory);
  } finally {
    closeConnection();
    if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    if (previous.PROFILES_ROOT === undefined) delete process.env.PROFILES_ROOT;
    else process.env.PROFILES_ROOT = previous.PROFILES_ROOT;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** SQLite-shaped UTC stamp used as the moment a resumed leg was last active. */
const LEG_ENDED_AT = '2026-01-01 00:00:00';

/** One turn before the leg went away, one after — so `since` is observable. */
const HISTORY: PrimerMessage[] = [
  {
    kind: 'text',
    role: 'user',
    content: 'turn from before the leg was parked',
    timestamp: '2025-12-31T12:00:00.000Z',
  },
  {
    kind: 'text',
    role: 'assistant',
    content: 'turn from after the leg was parked',
    timestamp: '2026-01-02T12:00:00.000Z',
  },
];

/** Drops the credential artifact that marks a profile as signed in. */
function authenticate(profile: ProfileView): void {
  const credentialPath = resolveCredentialPath(
    profile.provider,
    resolveProfileDir(profile.provider, profile.slug),
  );
  fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
  fs.writeFileSync(credentialPath, '{}');
}

function createSession(sessionId: string, ownerId: string): SessionRow {
  sessionsDb.createSession(
    sessionId,
    'claude',
    '/tmp/handoff-leg-repo',
    'S',
    undefined,
    undefined,
    null,
    ownerId,
    '/tmp/handoff-leg-repo-wt',
    'feature/leg',
  );
  return sessionsDb.getSessionById(sessionId) as SessionRow;
}

/** Opens a leg and parks it at `LEG_ENDED_AT`, as an earlier switch would have. */
function openParkedLeg(
  sessionId: string,
  provider: string,
  profileId: string,
  native?: { providerSessionId: string; jsonlPath: string | null },
): LegRow {
  const leg = sessionLegsDb.openLeg({
    sessionId,
    provider,
    profileId,
    profileNameAtSwitch: null,
  });
  if (native) {
    sessionLegsDb.attachProviderSessionId(leg.leg_id, native.providerSessionId, native.jsonlPath);
  }
  getConnection()
    .prepare('UPDATE session_legs SET ended_at = ? WHERE leg_id = ?')
    .run(LEG_ENDED_AT, leg.leg_id);

  return sessionLegsDb.listLegs(sessionId).find((row) => row.leg_id === leg.leg_id) as LegRow;
}

function activeLeg(sessionId: string): LegRow | undefined {
  return sessionLegsDb.listLegs(sessionId).find((leg) => leg.ended_at === null);
}

test('a provider with no leg yet gets a fresh one and the whole conversation', async () => {
  await withLegEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(target);
    const session = createSession('leg-open', source.id);

    const result = await applyCrossProviderSwitch(session, target, async () => HISTORY);

    assert.equal(result.status, 'leg-opened');
    assert.equal(result.sessionId, session.session_id, 'the app-facing id never changes');
    assert.equal(result.profileId, target.id);
    assert.equal(result.primed, true);

    const legs = sessionLegsDb.listLegs(session.session_id);
    assert.equal(legs.length, 1);
    assert.equal(legs[0].seq, 0);
    assert.equal(legs[0].provider, 'codex');
    assert.equal(legs[0].profile_id, target.id);
    assert.equal(legs[0].provider_session_id, null, 'no native id until the first turn runs');
    assert.equal(legs[0].ended_at, null, 'the new leg is the active one');

    const row = sessionsDb.getSessionById(session.session_id) as SessionRow;
    assert.equal(row.provider, 'codex');
    assert.equal(row.profile_id, target.id);
    assert.equal(row.provider_session_id, null);
    assert.equal(row.jsonl_path, null);
    assert.equal(row.project_path, session.project_path, 'project travels with the session');
    assert.equal(row.worktree_path, session.worktree_path);
    assert.equal(row.worktree_branch, session.worktree_branch);

    const primerPath = resolveLegPrimerPath(target, session.session_id, 0);
    assert.equal(row.seed_primer_path, primerPath);
    const primer = fs.readFileSync(primerPath, 'utf8');
    assert.ok(primer.includes('turn from before the leg was parked'), 'full primer');
    assert.ok(primer.includes('turn from after the leg was parked'));
    assert.ok(primer.includes('Claude A'), 'primer attributes the source account');
  });
});

test('the primer file is named per leg, not per session', async () => {
  await withLegEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(target);
    const session = createSession('leg-primer-name', source.id);
    sessionLegsDb.openLeg({
      sessionId: session.session_id,
      provider: 'claude',
      profileId: source.id,
      profileNameAtSwitch: 'Claude A',
    });

    const result = await applyCrossProviderSwitch(session, target, async () => HISTORY);

    const expected = resolveLegPrimerPath(target, session.session_id, 1);
    assert.equal(result.primed, true);
    assert.ok(expected.endsWith(`${session.session_id}-1.md`), 'named after the leg it primes');
    assert.ok(fs.existsSync(expected));
    assert.equal(
      sessionsDb.getSessionById(session.session_id)?.seed_primer_path,
      expected,
      'the pointer follows the file',
    );
    const perSessionName = path.join(path.dirname(expected), `${session.session_id}.md`);
    assert.ok(
      !fs.existsSync(perSessionName),
      'the per-session name would collide across switches and is not used',
    );
  });
});

test('switching back to a provider resumes its leg with only what it missed', async () => {
  await withLegEnvironment(async (tempDirectory) => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(target);
    const session = createSession('leg-resume', source.id);

    const transcript = path.join(tempDirectory, 'codex-transcript.jsonl');
    fs.writeFileSync(transcript, '{}');
    const parked = openParkedLeg(session.session_id, 'codex', target.id, {
      providerSessionId: 'codex-native-id',
      jsonlPath: transcript,
    });
    sessionLegsDb.openLeg({
      sessionId: session.session_id,
      provider: 'claude',
      profileId: source.id,
      profileNameAtSwitch: 'Claude A',
    });

    const result = await applyCrossProviderSwitch(session, target, async () => HISTORY);

    assert.equal(result.status, 'leg-resumed');
    assert.equal(result.sessionId, session.session_id);
    assert.equal(
      sessionLegsDb.listLegs(session.session_id).length,
      2,
      'resuming reuses the leg instead of stacking a new one',
    );
    assert.equal(activeLeg(session.session_id)?.leg_id, parked.leg_id);

    const row = sessionsDb.getSessionById(session.session_id) as SessionRow;
    assert.equal(row.provider, 'codex');
    assert.equal(row.profile_id, target.id);
    assert.equal(row.provider_session_id, 'codex-native-id', 'next turn resumes natively');
    assert.equal(row.jsonl_path, transcript);

    const primer = fs.readFileSync(
      resolveLegPrimerPath(target, session.session_id, parked.seq),
      'utf8',
    );
    assert.ok(primer.includes('turn from after the leg was parked'), 'carries what it missed');
    assert.ok(
      !primer.includes('turn from before the leg was parked'),
      'turns this leg already saw are not replayed',
    );
  });
});

test('a leg that never ran a turn is resumed with the full conversation', async () => {
  await withLegEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(target);
    const session = createSession('leg-resume-unused', source.id);

    const parked = openParkedLeg(session.session_id, 'codex', target.id);
    sessionLegsDb.openLeg({
      sessionId: session.session_id,
      provider: 'claude',
      profileId: source.id,
      profileNameAtSwitch: 'Claude A',
    });

    const result = await applyCrossProviderSwitch(session, target, async () => HISTORY);

    assert.equal(result.status, 'leg-resumed');
    assert.equal(activeLeg(session.session_id)?.leg_id, parked.leg_id);
    assert.equal(sessionsDb.getSessionById(session.session_id)?.provider_session_id, null);

    const primer = fs.readFileSync(
      resolveLegPrimerPath(target, session.session_id, parked.seq),
      'utf8',
    );
    assert.ok(
      primer.includes('turn from before the leg was parked'),
      'a leg with no history of its own gets everything',
    );
    assert.ok(primer.includes('turn from after the leg was parked'));
  });
});

test('a leg whose transcript is gone degrades to a brand-new leg', async () => {
  await withLegEnvironment(async (tempDirectory) => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(target);
    const session = createSession('leg-missing-transcript', source.id);

    const parked = openParkedLeg(session.session_id, 'codex', target.id, {
      providerSessionId: 'codex-native-id',
      jsonlPath: path.join(tempDirectory, 'deleted-transcript.jsonl'),
    });
    sessionLegsDb.openLeg({
      sessionId: session.session_id,
      provider: 'claude',
      profileId: source.id,
      profileNameAtSwitch: 'Claude A',
    });

    const result = await applyCrossProviderSwitch(session, target, async () => HISTORY);

    assert.equal(result.status, 'leg-opened');
    const legs = sessionLegsDb.listLegs(session.session_id);
    assert.equal(legs.length, 3, 'the unusable leg is left alone and a new one is opened');
    assert.equal(activeLeg(session.session_id)?.seq, 2);
    assert.notEqual(activeLeg(session.session_id)?.leg_id, parked.leg_id);

    const row = sessionsDb.getSessionById(session.session_id) as SessionRow;
    assert.equal(row.provider, 'codex');
    assert.equal(row.provider_session_id, null, 'the dead native id is not resumed');
    assert.equal(row.jsonl_path, null);

    const primer = fs.readFileSync(resolveLegPrimerPath(target, session.session_id, 2), 'utf8');
    assert.ok(primer.includes('turn from before the leg was parked'), 'starts over with everything');
  });
});

test('an unreadable history still switches the session, without a primer', async () => {
  await withLegEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'cursor', name: 'Cursor B' });
    authenticate(target);
    const session = createSession('leg-history-throws', source.id);

    const result = await applyCrossProviderSwitch(session, target, async () => {
      throw new Error('history store is unavailable');
    });

    assert.equal(result.status, 'leg-opened');
    assert.equal(result.primed, false);
    const row = sessionsDb.getSessionById(session.session_id) as SessionRow;
    assert.equal(row.provider, 'cursor');
    assert.equal(row.profile_id, target.id);
    assert.equal(row.seed_primer_path, null, 'no pointer without a file');
    assert.equal(activeLeg(session.session_id)?.provider, 'cursor', 'the switch still happened');
  });
});

test('refuses a target account that is not signed in, before anything moves', async () => {
  await withLegEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'opencode', name: 'OpenCode B' });
    const session = createSession('leg-unauthenticated', source.id);
    sessionLegsDb.openLeg({
      sessionId: session.session_id,
      provider: 'claude',
      profileId: source.id,
      profileNameAtSwitch: 'Claude A',
    });

    await assert.rejects(
      applyCrossProviderSwitch(session, target, async () => HISTORY),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 400 &&
        error.code === 'HANDOFF_TARGET_NOT_AUTHENTICATED',
    );

    const legs = sessionLegsDb.listLegs(session.session_id);
    assert.equal(legs.length, 1, 'no leg opened for a dead account');
    assert.equal(legs[0].provider, 'claude');
    const row = sessionsDb.getSessionById(session.session_id) as SessionRow;
    assert.equal(row.provider, 'claude', 'the session stays on its previous leg');
    assert.equal(row.profile_id, source.id);
    assert.equal(row.seed_primer_path, null);
  });
});
