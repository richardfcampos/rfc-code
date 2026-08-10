import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveProfileRootForPath, resolveProfileScanRoots } from '@/modules/profiles/index.js';
// Imported directly from the service (not the `worktrees` barrel): the barrel
// re-exports `worktrees.module.ts`, which pulls in the projects module, which
// pulls in this providers module back in — a real import cycle that trips a
// "cannot access before initialization" error on the synchronizer classes.
import { resolveWorktreeContext } from '@/modules/repo-context/index.js';
import {
  buildLookupMap,
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
 * Session indexer for Claude transcript artifacts.
 */
export class ClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'claude' as const;
  private readonly claudeHome = path.join(os.homedir(), '.claude');

  /**
   * `runGit` is only ever supplied by tests, so they can fake worktree
   * resolution without shelling out to a real git binary. Production code
   * leaves it undefined and `resolveWorktreeContext` falls back to the real
   * runner.
   */
  constructor(private readonly runGit?: GitCommandRunner) {}

  /**
   * Returns true when a JSONL file is a subagent transcript rather than a
   * top-level session.
   *
   * Claude stores subagent transcripts under a `subagents/` directory, e.g.
   * `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl`.
   * Those files repeat the parent session's `sessionId`, so indexing them as
   * standalone sessions overwrites the parent row's `jsonl_path` and corrupts
   * the main session record. The recursive scan in `synchronize()` reaches
   * them, so both entry points must skip them.
   */
  private isSubagentTranscript(filePath: string): boolean {
    return path.normalize(filePath).split(path.sep).includes('subagents');
  }

  /**
   * Scans the default ~/.claude home plus every profile's isolated config
   * directory, upserting discovered sessions with the owning profile id (null
   * for the default home, keeping pre-feature sessions profile-less).
   */
  async synchronize(since?: Date): Promise<number> {
    const roots = [
      { home: this.claudeHome, profileId: null as string | null },
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
    const nameMap = await buildLookupMap(path.join(home, 'history.jsonl'), 'sessionId', 'display');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(home, 'projects'),
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    for (const filePath of files) {
      if (this.isSubagentTranscript(filePath)) {
        continue;
      }

      const parsed = await this.processSessionFile(filePath, nameMap);
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
   * Parses and upserts one Claude session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }
    if (this.isSubagentTranscript(filePath)) {
      return null;
    }

    const owningRoot = resolveProfileRootForPath(this.provider, filePath);
    const home = owningRoot?.home ?? this.claudeHome;
    const nameMap = await buildLookupMap(path.join(home, 'history.jsonl'), 'sessionId', 'display');
    const parsed = await this.processSessionFile(filePath, nameMap);
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
      owningRoot?.profileId ?? null,
      context.worktreePath,
      context.worktreeBranch
    );
  }

  /**
   * Extracts session metadata from one Claude JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const cwd = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!sessionId || !cwd) {
        return null;
      }

      return {
        sessionId,
        cwd,
      };
    });

    if (!parsed) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Claude Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Claude Session'),
      };
    }

    let sessionName = nameMap.get(parsed.sessionId);
    if (!sessionName) {
      sessionName = await this.extractSessionAiTitleFromEnd(filePath, parsed.sessionId);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Claude Session'),
    };
  }

  private async extractSessionAiTitleFromEnd(
    filePath: string,
    sessionId: string
  ): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const data = parsed as Record<string, unknown>;
        const eventType = typeof data.type === 'string' ? data.type : undefined;
        const eventSessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
        const aiTitle = typeof data.aiTitle === 'string' ? data.aiTitle : undefined;
        const lastPrompt = typeof data.lastPrompt === 'string' ? data.lastPrompt : undefined;
        const claudeRenamedTitle = typeof data.customTitle === 'string' ? data.customTitle : undefined;

        if (
          (eventType === 'ai-title' && eventSessionId === sessionId && aiTitle?.trim()) ||
          (eventType === 'last-prompt' && eventSessionId === sessionId && lastPrompt?.trim()) ||
          (eventType === "custom-title" && eventSessionId === sessionId && claudeRenamedTitle?.trim())
        ) {
          return aiTitle || lastPrompt || claudeRenamedTitle;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}
