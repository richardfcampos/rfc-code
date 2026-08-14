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
  sessionsDb,
  type SessionRow,
} from '@/modules/database/index.js';
import { profilesService, type ProfileView } from '@/modules/profiles/profiles.service.js';
import { resolveCredentialPath, resolveProfileDir } from '@/modules/profiles/profile-env.js';
import {
  resolvePrimerPath,
  seedCrossProviderSession,
} from '@/modules/profiles/handoff-seed.js';
import { AppError } from '@/shared/utils.js';

/** Boots an isolated DB + profiles root in a temp dir for one test. */
async function withSeedEnvironment(runTest: () => Promise<void>): Promise<void> {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
  };
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'handoff-seed-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PROFILES_ROOT = path.join(tempDirectory, 'profiles');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previous.DATABASE_PATH === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous.DATABASE_PATH;
    if (previous.PROFILES_ROOT === undefined) delete process.env.PROFILES_ROOT;
    else process.env.PROFILES_ROOT = previous.PROFILES_ROOT;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const HISTORY = [
  { kind: 'text', role: 'user', content: 'refactor the queue drain' },
  { kind: 'text', role: 'assistant', content: 'drained it in one transaction' },
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

/** A claude session running inside a worktree of its repository. */
function createWorktreeSession(sessionId: string, ownerId: string): SessionRow {
  sessionsDb.createSession(
    sessionId,
    'claude',
    '/tmp/handoff-seed-repo',
    'S',
    undefined,
    undefined,
    null,
    ownerId,
    '/tmp/handoff-seed-repo-wt',
    'feature/seed',
  );
  return sessionsDb.getSessionById(sessionId) as SessionRow;
}

function countSessions(): number {
  const row = getConnection().prepare('SELECT COUNT(*) AS total FROM sessions').get() as {
    total: number;
  };
  return row.total;
}

test('seeded session inherits the project and worktree the conversation runs in', async () => {
  await withSeedEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(target);
    const session = createWorktreeSession('seed-worktree', source.id);

    const result = await seedCrossProviderSession(session, target, async () => HISTORY);

    const seeded = sessionsDb.getSessionById(result.seededSessionId as string);
    assert.equal(seeded?.project_path, session.project_path);
    assert.equal(seeded?.worktree_path, session.worktree_path);
    assert.equal(seeded?.worktree_branch, session.worktree_branch);
  });
});

test('primer lands in the target profile dir and the row points at it', async () => {
  await withSeedEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'codex', name: 'Codex A' });
    const target = profilesService.createProfile({ provider: 'claude', name: 'Claude B' });
    authenticate(target);
    const session = createWorktreeSession('seed-primer-path', source.id);

    const result = await seedCrossProviderSession(session, target, async () => HISTORY);

    const expectedPath = resolvePrimerPath(target, result.seededSessionId as string);
    assert.equal(result.primed, true);
    assert.ok(fs.existsSync(expectedPath), 'primer file written under the target profile');
    assert.equal(
      sessionsDb.getSessionById(result.seededSessionId as string)?.seed_primer_path,
      expectedPath,
    );
    const primer = fs.readFileSync(expectedPath, 'utf8');
    assert.ok(primer.includes('refactor the queue drain'), 'prior turns rendered into the primer');
    assert.ok(primer.includes('Codex A'), 'primer attributes the source account');
  });
});

test('history with nothing renderable seeds a clean session and reports it', async () => {
  await withSeedEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'codex', name: 'Codex B' });
    authenticate(target);
    const session = createWorktreeSession('seed-empty-history', source.id);

    const result = await seedCrossProviderSession(session, target, async () => []);

    assert.equal(result.status, 'seeded');
    assert.equal(result.primed, false, 'caller can see the session starts without context');
    const seeded = sessionsDb.getSessionById(result.seededSessionId as string);
    assert.equal(seeded?.profile_id, target.id);
    assert.equal(seeded?.seed_primer_path, null, 'no pointer without a file');
    assert.ok(!fs.existsSync(resolvePrimerPath(target, result.seededSessionId as string)));
  });
});

test('an unreadable history still seeds the session, without a primer', async () => {
  await withSeedEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'cursor', name: 'Cursor B' });
    authenticate(target);
    const session = createWorktreeSession('seed-history-throws', source.id);

    const result = await seedCrossProviderSession(session, target, async () => {
      throw new Error('history store is unavailable');
    });

    assert.equal(result.status, 'seeded');
    assert.equal(result.primed, false);
    const seeded = sessionsDb.getSessionById(result.seededSessionId as string);
    assert.equal(seeded?.provider, 'cursor');
    assert.equal(seeded?.seed_primer_path, null);
  });
});

test('refuses a target account that is not signed in, before creating anything', async () => {
  await withSeedEnvironment(async () => {
    const source = profilesService.createProfile({ provider: 'claude', name: 'Claude A' });
    const target = profilesService.createProfile({ provider: 'opencode', name: 'OpenCode B' });
    const session = createWorktreeSession('seed-unauthenticated', source.id);
    const before = countSessions();

    await assert.rejects(
      seedCrossProviderSession(session, target, async () => HISTORY),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 400 &&
        error.code === 'HANDOFF_TARGET_NOT_AUTHENTICATED',
    );

    assert.equal(countSessions(), before, 'no session row allocated for a dead account');
  });
});
