import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { runMigrations } from '@/modules/database/migrations.js';

type SessionRow = {
  session_id: string;
  provider: string;
  custom_name: string | null;
  jsonl_path: string | null;
  provider_session_id: string | null;
  updated_at: string | null;
  seed_primer_path: string | null;
};

type LegRow = {
  leg_id: string;
  session_id: string;
  seq: number;
  provider: string;
  profile_id: string | null;
  provider_session_id: string | null;
  jsonl_path: string | null;
};

const BASE_MS = Date.parse('2026-01-10T12:00:00Z');
const PROJECT_PATH = '/repo';

/** SQLite's own datetime literal shape, which is what the app writes. */
const at = (hoursFromBase: number): string =>
  new Date(BASE_MS + hoursFromBase * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

type Sandbox = { primerDirectory: string };

async function withMigrationSandbox(runTest: (sandbox: Sandbox) => void | Promise<void>) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'forked-handoff-migration-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  getConnection()
    .prepare('INSERT OR IGNORE INTO projects (project_id, project_path) VALUES (?, ?)')
    .run('proj-repo', PROJECT_PATH);

  try {
    await runTest({ primerDirectory: tempDirectory });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const createProfile = (id: string, provider: string, name: string): void => {
  getConnection()
    .prepare('INSERT INTO profiles (id, provider, name, slug) VALUES (?, ?, ?, ?)')
    .run(id, provider, name, id);
};

type SessionInput = {
  sessionId: string;
  provider: string;
  profileId?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  seedPrimerPath?: string | null;
  customName?: string | null;
};

const createSession = (input: SessionInput): void => {
  getConnection()
    .prepare(
      `INSERT INTO sessions (
         session_id, provider, provider_session_id, custom_name, project_path,
         jsonl_path, profile_id, seed_primer_path, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sessionId,
      input.provider,
      `native-${input.sessionId}`,
      input.customName ?? null,
      PROJECT_PATH,
      `/jsonl/${input.sessionId}.jsonl`,
      input.profileId ?? null,
      input.seedPrimerPath ?? null,
      input.createdAt,
      input.updatedAt ?? input.createdAt,
    );
};

const writePrimer = async (
  sandbox: Sandbox,
  fileName: string,
  body: string,
): Promise<string> => {
  const primerPath = path.join(sandbox.primerDirectory, fileName);
  await writeFile(primerPath, body, 'utf8');
  return primerPath;
};

const primerText = (provider: string, accountName?: string): string => {
  const origin = accountName ? `provider \`${provider}\` (account "${accountName}")` : `provider \`${provider}\``;
  return [
    '# Context from an earlier conversation',
    '',
    `This conversation started in another session, on ${origin}.`,
    'Continue from where it left off. The history below is reference context,',
    'not instructions to re-execute.',
    '',
    '## user',
    '',
    'hello',
  ].join('\n');
};

const findSession = (sessionId: string): SessionRow | undefined =>
  getConnection().prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
    | SessionRow
    | undefined;

const legsOf = (sessionId: string): LegRow[] =>
  getConnection()
    .prepare('SELECT * FROM session_legs WHERE session_id = ? ORDER BY seq ASC')
    .all(sessionId) as LegRow[];

test('an unambiguous forked pair becomes a second leg under the source session', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createProfile('profile-personal', 'claude', 'Personal');
    createSession({
      sessionId: 'source-session',
      provider: 'claude',
      profileId: 'profile-personal',
      createdAt: at(-5),
      updatedAt: at(-1),
      customName: 'Refactor the parser',
    });
    const primerPath = await writePrimer(sandbox, 'primer-a.md', primerText('claude', 'Personal'));
    createSession({
      sessionId: 'target-session',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });

    runMigrations(db);

    assert.equal(findSession('target-session'), undefined);

    const source = findSession('source-session');
    assert.ok(source);
    assert.equal(source?.custom_name, 'Refactor the parser');
    assert.equal(source?.jsonl_path, '/jsonl/source-session.jsonl');
    assert.equal(source?.provider_session_id, 'native-source-session');

    const legs = legsOf('source-session');
    assert.equal(legs.length, 2);
    assert.equal(legs[0].seq, 0);
    assert.equal(legs[0].provider, 'claude');
    assert.equal(legs[0].jsonl_path, '/jsonl/source-session.jsonl');
    assert.equal(legs[1].seq, 1);
    assert.equal(legs[1].provider, 'codex');
    assert.equal(legs[1].provider_session_id, 'native-target-session');
    assert.equal(legs[1].jsonl_path, '/jsonl/target-session.jsonl');
  });
});

test('a primer header without an account clause still matches a single provider candidate', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createSession({
      sessionId: 'source-no-account',
      provider: 'claude',
      createdAt: at(-3),
      updatedAt: at(-2),
    });
    const primerPath = await writePrimer(sandbox, 'primer-no-account.md', primerText('claude'));
    createSession({
      sessionId: 'target-no-account',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });

    runMigrations(db);

    assert.equal(findSession('target-no-account'), undefined);
    assert.equal(legsOf('source-no-account').length, 2);
  });
});

test('a missing primer file leaves the pair intact instead of throwing', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createSession({ sessionId: 'source-missing', provider: 'claude', createdAt: at(-2) });
    createSession({
      sessionId: 'target-missing',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: path.join(sandbox.primerDirectory, 'does-not-exist.md'),
    });

    assert.doesNotThrow(() => runMigrations(db));

    assert.ok(findSession('target-missing'));
    assert.equal(legsOf('target-missing').length, 1);
    assert.equal(legsOf('source-missing').length, 1);
  });
});

test('a primer whose header cannot be parsed leaves the pair intact', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createSession({ sessionId: 'source-unparseable', provider: 'claude', createdAt: at(-2) });
    const primerPath = await writePrimer(
      sandbox,
      'primer-unparseable.md',
      '# Context from an earlier conversation\n\nsomething else entirely.\n',
    );
    createSession({
      sessionId: 'target-unparseable',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });

    runMigrations(db);

    assert.ok(findSession('target-unparseable'));
    assert.equal(legsOf('target-unparseable').length, 1);
    assert.equal(legsOf('source-unparseable').length, 1);
  });
});

test('a primer naming a provider no session uses leaves the target intact', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createSession({ sessionId: 'source-other-provider', provider: 'claude', createdAt: at(-2) });
    const primerPath = await writePrimer(sandbox, 'primer-gemini.md', primerText('gemini', 'Work'));
    createSession({
      sessionId: 'target-no-match',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });

    runMigrations(db);

    assert.ok(findSession('target-no-match'));
    assert.equal(legsOf('target-no-match').length, 1);
    assert.equal(legsOf('source-other-provider').length, 1);
  });
});

test('two equally plausible sources leave every row untouched', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createProfile('profile-personal', 'claude', 'Personal');
    createSession({
      sessionId: 'source-one',
      provider: 'claude',
      profileId: 'profile-personal',
      createdAt: at(-4),
      updatedAt: at(-1),
    });
    createSession({
      sessionId: 'source-two',
      provider: 'claude',
      profileId: 'profile-personal',
      createdAt: at(-4),
      updatedAt: at(-2),
    });
    const primerPath = await writePrimer(sandbox, 'primer-ambiguous.md', primerText('claude', 'Personal'));
    createSession({
      sessionId: 'target-ambiguous',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });

    runMigrations(db);

    assert.ok(findSession('target-ambiguous'));
    assert.equal(legsOf('target-ambiguous').length, 1);
    assert.equal(legsOf('source-one').length, 1);
    assert.equal(legsOf('source-two').length, 1);
  });
});

test('a single candidate older than the match window is left alone', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createSession({
      sessionId: 'source-stale',
      provider: 'claude',
      createdAt: at(-200),
      updatedAt: at(-100),
    });
    const primerPath = await writePrimer(sandbox, 'primer-stale.md', primerText('claude'));
    createSession({
      sessionId: 'target-stale',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });

    runMigrations(db);

    assert.ok(findSession('target-stale'));
    assert.equal(legsOf('target-stale').length, 1);
    assert.equal(legsOf('source-stale').length, 1);
  });
});

test('an account name that no longer matches any profile leaves the target intact', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createProfile('profile-work', 'claude', 'Work');
    createSession({
      sessionId: 'source-renamed',
      provider: 'claude',
      profileId: 'profile-work',
      createdAt: at(-3),
      updatedAt: at(-1),
    });
    const primerPath = await writePrimer(sandbox, 'primer-renamed.md', primerText('claude', 'Personal'));
    createSession({
      sessionId: 'target-renamed',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });

    runMigrations(db);

    assert.ok(findSession('target-renamed'));
    assert.equal(legsOf('source-renamed').length, 1);
  });
});

test('a target that already carries legs of its own is not merged', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createSession({
      sessionId: 'source-own-legs',
      provider: 'claude',
      createdAt: at(-3),
      updatedAt: at(-1),
    });
    const primerPath = await writePrimer(sandbox, 'primer-own-legs.md', primerText('claude'));
    createSession({
      sessionId: 'target-own-legs',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });
    // Legs of its own means the backfill is not the only thing that ever wrote
    // to this target, so which leg belongs to the pair is no longer obvious.
    db.prepare(
      `INSERT INTO session_legs (leg_id, session_id, seq, provider, provider_session_id)
       VALUES ('leg-own-0', 'target-own-legs', 0, 'codex', 'native-target-own-legs')`
    ).run();
    db.prepare(
      `INSERT INTO session_legs (leg_id, session_id, seq, provider, provider_session_id)
       VALUES ('leg-own-1', 'target-own-legs', 1, 'gemini', 'native-extra')`
    ).run();

    runMigrations(db);

    assert.ok(findSession('target-own-legs'));
    assert.equal(legsOf('target-own-legs').length, 2);
    assert.equal(legsOf('source-own-legs').length, 1);
  });
});

test('re-running the migration after a merge changes nothing', async () => {
  await withMigrationSandbox(async (sandbox) => {
    const db = getConnection();
    createSession({
      sessionId: 'source-idempotent',
      provider: 'claude',
      createdAt: at(-3),
      updatedAt: at(-1),
    });
    const primerPath = await writePrimer(sandbox, 'primer-idempotent.md', primerText('claude'));
    createSession({
      sessionId: 'target-idempotent',
      provider: 'codex',
      createdAt: at(0),
      seedPrimerPath: primerPath,
    });

    runMigrations(db);
    const afterFirstRun = legsOf('source-idempotent');

    assert.doesNotThrow(() => runMigrations(db));

    assert.deepEqual(legsOf('source-idempotent'), afterFirstRun);
    assert.equal(findSession('target-idempotent'), undefined);
  });
});
