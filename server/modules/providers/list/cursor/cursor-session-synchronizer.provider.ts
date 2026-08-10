import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveProfileRootForPath, resolveProfileScanRoots } from '@/modules/profiles/index.js';
// Imported directly from the service (not the `worktrees` barrel): the barrel
// re-exports `worktrees.module.ts`, which pulls in the projects module, which
// pulls in this providers module back in — a real import cycle that trips a
// "cannot access before initialization" error on the synchronizer classes.
import { resolveWorktreeContext } from '@/modules/repo-context/index.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { GitCommandRunner } from '@/shared/types.js';

type ParsedSession = {
  sessionId: string;
  cwd: string;
  sessionName?: string;
};

/**
 * Returns directory entries or an empty list when the folder is missing.
 */
async function listDirectoryEntriesSafe(
  directoryPath: string
): Promise<import('node:fs').Dirent[]> {
  try {
    return await fsp.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Session indexer for Cursor transcript artifacts.
 */
export class CursorSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'cursor' as const;
  private readonly cursorHome = path.join(os.homedir(), '.cursor');

  /**
   * `runGit` is only ever supplied by tests, so they can fake worktree
   * resolution without shelling out to a real git binary. Production code
   * leaves it undefined and `resolveWorktreeContext` falls back to the real
   * runner.
   */
  constructor(private readonly runGit?: GitCommandRunner) {}

  /**
   * Scans the default ~/.cursor home plus every profile's isolated cursor home,
   * upserting discovered sessions with the owning profile id (null for the
   * default home, keeping pre-feature sessions profile-less).
   */
  async synchronize(since?: Date): Promise<number> {
    const roots = [
      { home: this.cursorHome, profileId: null as string | null },
      ...resolveProfileScanRoots(this.provider),
    ];

    let processed = 0;
    for (const root of roots) {
      processed += await this.synchronizeHome(root.home, root.profileId, since);
    }
    return processed;
  }

  private async synchronizeHome(
    home: string,
    profileId: string | null,
    since?: Date
  ): Promise<number> {
    const projectsDir = path.join(home, 'projects');
    const files = await findFilesRecursivelyCreatedAfter(projectsDir, '.jsonl', since ?? null);

    let processed = 0;
    for (const filePath of files) {
      const parsed = await this.processSessionFile(filePath);
      if (!parsed) {
        continue;
      }

      const context = await resolveWorktreeContext(parsed.cwd, this.runGit);
      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        context.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath,
        profileId,
        context.worktreePath,
        context.worktreeBranch
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Cursor session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    const parsed = await this.processSessionFile(filePath);
    if (!parsed) {
      return null;
    }

    const context = await resolveWorktreeContext(parsed.cwd, this.runGit);
    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      context.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
      resolveProfileRootForPath(this.provider, filePath)?.profileId ?? null,
      context.worktreePath,
      context.worktreeBranch
    );
  }

  /**
   * Extracts project path from Cursor worker.log.
   */
  private async extractProjectPathFromWorkerLog(filePath: string): Promise<string | null> {
    try {
      const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of lineReader) {
        const match = line.match(/workspacePath=(.*)$/);
        const projectPath = match?.[1]?.trim();
        if (projectPath) {
          lineReader.close();
          fileStream.close();
          return projectPath;
        }
      }
    } catch {
      // Missing worker logs are valid for partial or incomplete session data.
    }

    return null;
  }

  /**
   * Extracts session metadata from one Cursor JSONL session file.
   */
  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    const sessionId = path.basename(filePath, '.jsonl');
    const grandparentDir = path.dirname(path.dirname(path.dirname(filePath)));
    const workerLogPath = path.join(grandparentDir, 'worker.log');
    const cwd = await this.extractProjectPathFromWorkerLog(workerLogPath);

    if (!cwd) {
      return null;
    }

    return extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, any>;
      if (data.role !== 'user') {
        return null;
      }

      const text = typeof data.message?.content?.[0]?.text === 'string' ? data.message.content[0].text : '';
      // Drop Cursor's `<timestamp>…</timestamp>` prefix and `<user_query>` tags
      // so the session name comes from the actual first line the user typed.
      const firstLine = text
        .replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '')
        .replace(/<\/?user_query>/g, '')
        .trim()
        .split('\n')[0];

      return {
        sessionId,
        cwd,
        sessionName: normalizeSessionName(firstLine, 'Untitled Cursor Session'),
      };
    });
  }
}
