import fsSync from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveProfileRootForPath, resolveProfileScanRoots } from '@/modules/profiles/index.js';
// Imported directly from the service (not the `worktrees` barrel): the barrel
// re-exports `worktrees.module.ts`, which pulls in the projects module, which
// pulls in this providers module back in — a real import cycle that trips a
// "cannot access before initialization" error on the synchronizer classes.
import { resolveWorktreeContext } from '@/modules/repo-context/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { GitCommandRunner } from '@/shared/types.js';
import {
  getOpenCodeDatabasePath,
  normalizeProviderTimestamp,
  normalizeSessionName,
  readJsonRecord,
  readOptionalString,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

type OpenCodeSessionRow = {
  id: string;
  directory: string | null;
  title: string | null;
  time_created: number | null;
  time_updated: number | null;
  worktree: string | null;
};

type SynchronizeRowsResult = {
  processed: number;
  firstSessionId: string | null;
};

/**
 * Session indexer for OpenCode's SQLite-backed session store.
 */
export class OpenCodeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'opencode' as const;

  /**
   * `runGit` is only ever supplied by tests, so they can fake worktree
   * resolution without shelling out to a real git binary. Production code
   * leaves it undefined and `resolveWorktreeContext` falls back to the real
   * runner.
   */
  constructor(private readonly runGit?: GitCommandRunner) {}

  /**
   * Scans the default shared opencode.db plus every profile's isolated
   * opencode.db, upserting active sessions with the owning profile id (null for
   * the default db, keeping pre-feature sessions profile-less).
   */
  async synchronize(since?: Date): Promise<number> {
    const dbRoots = [
      { dbPath: getOpenCodeDatabasePath(), profileId: null as string | null },
      ...resolveProfileScanRoots(this.provider).map((root) => ({
        dbPath: path.join(root.home, 'opencode.db'),
        profileId: root.profileId,
      })),
    ];

    let processed = 0;
    for (const root of dbRoots) {
      processed += (await this.synchronizeRows(root.dbPath, root.profileId, since)).processed;
    }
    return processed;
  }

  /**
   * Handles watcher changes for opencode.db.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.basename(filePath) !== 'opencode.db') {
      return null;
    }

    const profileId = resolveProfileRootForPath(this.provider, filePath)?.profileId ?? null;
    const result = await this.synchronizeRows(filePath, profileId, undefined, 1);
    return result.firstSessionId;
  }

  private async synchronizeRows(
    dbPath: string,
    profileId: string | null,
    since?: Date,
    limit?: number
  ): Promise<SynchronizeRowsResult> {
    if (!fsSync.existsSync(dbPath)) {
      return { processed: 0, firstSessionId: null };
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const sinceMillis = since?.getTime() ?? null;
      const limitClause = limit ? 'LIMIT ?' : '';
      const params = limit ? [sinceMillis, sinceMillis, limit] : [sinceMillis, sinceMillis];
      const rows = db.prepare(`
        SELECT
          s.id AS id,
          s.directory AS directory,
          s.title AS title,
          s.time_created AS time_created,
          s.time_updated AS time_updated,
          p.worktree AS worktree
        FROM session s
        LEFT JOIN project p ON p.id = s.project_id
        WHERE s.time_archived IS NULL
          AND (? IS NULL OR COALESCE(s.time_updated, s.time_created, 0) >= ?)
        ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC, s.id DESC
        ${limitClause}
      `).all(...params) as OpenCodeSessionRow[];

      let processed = 0;
      let firstSessionId: string | null = null;
      for (const row of rows) {
        const indexedSessionId = await this.upsertSession(db, row, profileId);
        if (!indexedSessionId) {
          continue;
        }

        if (!firstSessionId) {
          firstSessionId = indexedSessionId;
        }
        processed += 1;
      }

      return { processed, firstSessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[OpenCodeProvider] Failed to synchronize sessions:', message);
      return { processed: 0, firstSessionId: null };
    } finally {
      db.close();
    }
  }

  private async upsertSession(
    db: Database.Database,
    row: OpenCodeSessionRow,
    profileId: string | null
  ): Promise<string | null> {
    const sessionId = readOptionalString(row.id);
    const cwd = readOptionalString(row.directory) ?? readOptionalString(row.worktree);
    if (!sessionId || !cwd) {
      return null;
    }

    const fallbackTitle = 'Untitled OpenCode Session';
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, cwd);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      // Slow networks can let the sqlite watcher index opencode.db before the
      // runtime reports its provider id back through the websocket mapping.
      // Bind that id to the fresh app row first so the watcher does not create
      // a temporary provider-id sidebar entry for the same session.
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, sessionId);
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    const existingName = existingSession?.custom_name;

    // Sessions started by sending a message from cloudcli carry a distinct
    // app-allocated session_id mapped to the provider id. For these we title the
    // conversation from the first user message the user typed, matching how the
    // app titles a brand-new conversation. Sessions discovered purely by
    // indexing (session_id === provider_session_id) keep OpenCode's own stored
    // title.
    const isAppCreated =
      existingSession != null &&
      existingSession.provider_session_id != null &&
      existingSession.session_id !== existingSession.provider_session_id;

    let nextName: string | undefined;
    if (existingName && existingName !== fallbackTitle) {
      nextName = existingName;
    } else if (isAppCreated) {
      nextName = this.readFirstUserText(db, sessionId) ?? readOptionalString(row.title);
    } else {
      nextName = readOptionalString(row.title) ?? this.readFirstUserText(db, sessionId);
    }

    const context = await resolveWorktreeContext(cwd, this.runGit);

    // OpenCode stores every session in one shared sqlite database, so jsonl_path
    // must stay null to avoid deleting opencode.db when one app session is removed.
    // Return the canonical stored row id so watcher-triggered sidebar updates
    // stay on the app session once provider_session_id has already been mapped.
    return sessionsDb.createSession(
      sessionId,
      this.provider,
      context.projectPath,
      normalizeSessionName(nextName, fallbackTitle),
      normalizeProviderTimestamp(row.time_created),
      normalizeProviderTimestamp(row.time_updated ?? row.time_created),
      null,
      profileId,
      context.worktreePath,
      context.worktreeBranch,
    );
  }

  private readFirstUserText(db: Database.Database, sessionId: string): string | undefined {
    try {
      const row = db.prepare(`
        SELECT p.data AS data
        FROM message m
        INNER JOIN part p
          ON p.session_id = m.session_id
         AND p.message_id = m.id
        WHERE m.session_id = ?
          AND json_extract(m.data, '$.role') = 'user'
          AND json_extract(p.data, '$.type') = 'text'
        ORDER BY COALESCE(m.time_created, 0), COALESCE(p.time_created, 0)
        LIMIT 1
      `).get(sessionId) as { data: string | null } | undefined;

      const data = readJsonRecord(row?.data);
      const text = readOptionalString(data?.text);
      // OpenCode persists the first prompt as a JSON string literal (e.g.
      // `"hello"`), so decode it to avoid titling the session with quotes.
      return text === undefined ? undefined : unwrapJsonStringLiteral(text);
    } catch {
      return undefined;
    }
  }
}
