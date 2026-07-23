import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { profilesService } from '@/modules/profiles/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CursorSessionSynchronizer } from '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js';
import { OpenCodeSessionSynchronizer } from '@/modules/providers/list/opencode/opencode-session-synchronizer.provider.js';

async function withProfilesEnvironment(
  runTest: (context: { profilesRoot: string; tempDir: string }) => void | Promise<void>,
): Promise<void> {
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    PROFILES_ROOT: process.env.PROFILES_ROOT,
  };
  const tempDir = await mkdtemp(path.join(tmpdir(), 'profile-aware-sync-'));
  const profilesRoot = path.join(tempDir, 'profiles');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDir, 'auth.db');
  process.env.PROFILES_ROOT = profilesRoot;
  await initializeDatabase();

  try {
    await runTest({ profilesRoot, tempDir });
  } finally {
    closeConnection();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeArtifact(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

test('claude sync stamps the owning profile id on a session under a profile home', async () => {
  await withProfilesEnvironment(async ({ profilesRoot }) => {
    const profile = profilesService.createProfile({ provider: 'claude', name: 'Account A' });
    const artifact = path.join(
      profilesRoot,
      'claude',
      profile.slug,
      'projects',
      'encoded',
      'claude-sess-1.jsonl',
    );
    await writeArtifact(artifact, JSON.stringify({ sessionId: 'claude-sess-1', cwd: '/workspace/demo' }));

    await new ClaudeSessionSynchronizer().synchronizeFile(artifact);

    assert.equal(sessionsDb.getSessionById('claude-sess-1')?.profile_id, profile.id);
  });
});

test('claude sync leaves profile_id null for a session outside any profile home', async () => {
  await withProfilesEnvironment(async ({ tempDir }) => {
    profilesService.createProfile({ provider: 'claude', name: 'Account A' });
    const looseArtifact = path.join(tempDir, 'loose', 'projects', 'x', 'loose-sess.jsonl');
    await writeArtifact(looseArtifact, JSON.stringify({ sessionId: 'loose-sess', cwd: '/workspace/demo' }));

    await new ClaudeSessionSynchronizer().synchronizeFile(looseArtifact);

    assert.equal(sessionsDb.getSessionById('loose-sess')?.profile_id, null);
  });
});

test('codex sync stamps the owning profile id on a session under a profile home', async () => {
  await withProfilesEnvironment(async ({ profilesRoot }) => {
    const profile = profilesService.createProfile({ provider: 'codex', name: 'Account A' });
    const artifact = path.join(
      profilesRoot,
      'codex',
      profile.slug,
      'sessions',
      '2026',
      'codex-sess-1.jsonl',
    );
    await writeArtifact(
      artifact,
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'codex-sess-1', cwd: '/workspace/demo', thread_source: 'user', source: 'cli' },
      }),
    );

    await new CodexSessionSynchronizer().synchronizeFile(artifact);

    assert.equal(sessionsDb.getSessionById('codex-sess-1')?.profile_id, profile.id);
  });
});

test('cursor sync stamps the owning profile id on a session under a profile home', async () => {
  await withProfilesEnvironment(async ({ profilesRoot }) => {
    const profile = profilesService.createProfile({ provider: 'cursor', name: 'Account A' });
    const cursorHome = path.join(profilesRoot, 'cursor', profile.slug, '.cursor');
    const artifact = path.join(cursorHome, 'projects', 'hash', 'chats', 'cursor-sess-1.jsonl');
    // worker.log lives at dirname^3(artifact) = <cursorHome>/projects/worker.log
    await writeArtifact(path.join(cursorHome, 'projects', 'worker.log'), 'workspacePath=/workspace/demo\n');
    await writeArtifact(
      artifact,
      JSON.stringify({ role: 'user', message: { content: [{ text: 'hello world' }] } }),
    );

    await new CursorSessionSynchronizer().synchronizeFile(artifact);

    assert.equal(sessionsDb.getSessionById('cursor-sess-1')?.profile_id, profile.id);
  });
});

test('opencode sync stamps the owning profile id from a profile-scoped opencode.db', async () => {
  await withProfilesEnvironment(async ({ profilesRoot }) => {
    const profile = profilesService.createProfile({ provider: 'opencode', name: 'Account A' });
    const dbPath = path.join(profilesRoot, 'opencode', profile.slug, 'data', 'opencode', 'opencode.db');
    await mkdir(path.dirname(dbPath), { recursive: true });

    const seed = new Database(dbPath);
    seed.exec(`
      CREATE TABLE project (id TEXT, worktree TEXT);
      CREATE TABLE session (
        id TEXT, directory TEXT, title TEXT,
        time_created INTEGER, time_updated INTEGER, time_archived INTEGER, project_id TEXT
      );
      INSERT INTO project (id, worktree) VALUES ('p1', '/workspace/demo');
      INSERT INTO session (id, directory, title, time_created, time_updated, time_archived, project_id)
        VALUES ('oc-sess-1', '/workspace/demo', 'My OpenCode Session', 1000, 2000, NULL, 'p1');
    `);
    seed.close();

    await new OpenCodeSessionSynchronizer().synchronize();

    assert.equal(sessionsDb.getSessionById('oc-sess-1')?.profile_id, profile.id);
  });
});
